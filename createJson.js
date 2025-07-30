const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

// Function to read JSON template based on company code
function loadTemplate(companyCode) {
    const templatePath = path.join(__dirname, 'Sample', `${companyCode}.json`);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found for company code: ${companyCode}`);
    }
    return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
}

// Function to deep clone an object
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Function to create JSON body for a single record
function createJSONBody(template, prepaymentRequestNumber, zsfnValue, testId) {
    const jsonBody = deepClone(template);
    const salesOrderItem = jsonBody.SalesOrder[0].SalesOrderItem[0];
    
    // Update PrepaymentRequestnumber
    salesOrderItem.PrepaymentRequestnumber = prepaymentRequestNumber || '';
    
    // Update the three fields based on testId
    salesOrderItem.YY1_SFDCLINEID_I = testId;
    salesOrderItem.YY1_SALESFORCEID_I = testId;
    salesOrderItem.YY1_BATCHID_I = testId;
    
    // Update SalesOrderItemsSet
    jsonBody.SalesOrder[0].SalesOrderItemsSet = [testId];
    
    // Update ZSFN value in PricingElement
    const zsfnElement = salesOrderItem.PricingElement.find(pe => pe.ConditionType === 'ZSFN');
    if (zsfnElement && zsfnValue !== null && zsfnValue !== undefined) {
        zsfnElement.ConditionRateValue = parseFloat(zsfnValue) || 0;
    }
    
    return jsonBody;
}

// Function to process a single CSV record
function processRecord(record, template) {
    const results = [];
    const originalPrepaymentNumber = record['Original Prepayment Request Number'];
    const generatedPrepaymentNumber = record['Generated Prepayment Request Number'];
    const zsfnValue = record['ZFSN'];
    
    // Parse ZSFN values (can be single or multiple with comma delimiter)
    let zsfnValues = [];
    if (zsfnValue !== null && zsfnValue !== undefined && zsfnValue !== '') {
        if (typeof zsfnValue === 'string' && zsfnValue.includes(',')) {
            zsfnValues = zsfnValue.split(',').map(v => v.trim()).filter(v => v !== '');
        } else {
            zsfnValues = [zsfnValue];
        }
    }
    
    // Handle different scenarios for Generated Prepayment Request Number
    if (generatedPrepaymentNumber === null || generatedPrepaymentNumber === undefined || generatedPrepaymentNumber === '') {
        // Blank scenario: create one JSON with blank PrepaymentRequestnumber
        const testId = `TEST1ROUND_${originalPrepaymentNumber}1`;
        const zsfn = zsfnValues.length > 0 ? zsfnValues[0] : null;
        results.push(createJSONBody(template, '', zsfn, testId));
        
    } else if (typeof generatedPrepaymentNumber === 'string' && (generatedPrepaymentNumber.includes(',') || generatedPrepaymentNumber.trim() === ',')) {
        // Multiple commas scenario: create multiple JSONs
        const parts = generatedPrepaymentNumber.split(',').map(p => p.trim());
        const nonEmptyParts = parts.filter(p => p !== '');
        
        if (nonEmptyParts.length === 0) {
            // Only commas, create multiple based on ZSFN count or default to parts length
            const count = Math.max(zsfnValues.length, parts.length);
            for (let i = 0; i < count; i++) {
                const testId = `TEST1ROUND_${originalPrepaymentNumber}${i + 1}`;
                const zsfn = zsfnValues[i] || null;
                results.push(createJSONBody(template, '', zsfn, testId));
            }
        } else {
            // Has actual values separated by commas
            // Check if all values are the same
            const uniqueValues = [...new Set(nonEmptyParts)];
            
            if (uniqueValues.length === 1) {
                // All values are the same, add incremental numbers
                const baseValue = uniqueValues[0];
                nonEmptyParts.forEach((part, index) => {
                    const testId = `TEST1ROUND_${baseValue}${index + 1}`;
                    const zsfn = zsfnValues[index] || zsfnValues[0] || null;
                    results.push(createJSONBody(template, uniqueValues[0], zsfn, testId));
                });
            } else {
                // Values are different, use as is
                nonEmptyParts.forEach((part, index) => {
                    const testId = `TEST1ROUND_${part}`;
                    const zsfn = zsfnValues[index] || zsfnValues[0] || null;
                    results.push(createJSONBody(template, part, zsfn, testId));
                });
            }
        }
        
    } else {
        // Single value scenario
        const testId = `TEST1ROUND_${generatedPrepaymentNumber}`;
        const zsfn = zsfnValues.length > 0 ? zsfnValues[0] : null;
        results.push(createJSONBody(template, generatedPrepaymentNumber, zsfn, testId));
    }
    
    return results;
}

// Main function
function main() {
    try {
        // Read and parse CSV file
        const csvFilePath = path.join(__dirname, 'processing-results.csv');
        const csvContent = fs.readFileSync(csvFilePath, 'utf8');
        
        const parsedData = Papa.parse(csvContent, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            delimitersToGuess: [',', '\t', '|', ';']
        });
        
        // Clean headers by trimming whitespace
        const cleanedData = parsedData.data.map(row => {
            const cleanRow = {};
            Object.keys(row).forEach(key => {
                const cleanKey = key.trim();
                cleanRow[cleanKey] = row[key];
            });
            return cleanRow;
        });
        
        console.log(`Processing ${cleanedData.length} records...`);
        
        // Group records by company code
        const recordsByCompany = {};
        cleanedData.forEach(record => {
            const companyCode = record['Company Code'];
            if (!recordsByCompany[companyCode]) {
                recordsByCompany[companyCode] = [];
            }
            recordsByCompany[companyCode].push(record);
        });
        
        // Process each company group
        let totalJsonsCreated = 0;
        const outputDir = path.join(__dirname, 'output');
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        Object.keys(recordsByCompany).forEach(companyCode => {
            console.log(`\nProcessing company: ${companyCode}`);
            
            try {
                const template = loadTemplate(companyCode);
                const records = recordsByCompany[companyCode];
                const allJsonBodies = [];
                
                records.forEach((record, index) => {
                    const jsonBodies = processRecord(record, template);
                    allJsonBodies.push(...jsonBodies);
                    console.log(`  Record ${index + 1}: Generated ${jsonBodies.length} JSON(s)`);
                });
                
                // Write all JSON bodies for this company to a file
                const outputFilePath = path.join(outputDir, `${companyCode}_generated.json`);
                fs.writeFileSync(outputFilePath, JSON.stringify(allJsonBodies, null, 2));
                
                console.log(`  Total JSONs created for ${companyCode}: ${allJsonBodies.length}`);
                console.log(`  Output written to: ${outputFilePath}`);
                totalJsonsCreated += allJsonBodies.length;
                
            } catch (error) {
                console.error(`Error processing company ${companyCode}:`, error.message);
            }
        });
        
        console.log(`\n=== Summary ===`);
        console.log(`Total records processed: ${cleanedData.length}`);
        console.log(`Total JSON bodies created: ${totalJsonsCreated}`);
        console.log(`Output directory: ${outputDir}`);
        
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { main, processRecord, createJSONBody };