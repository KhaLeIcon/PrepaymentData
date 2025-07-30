const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const sendRequest = require('./sendRequest');

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

// Function to process a single CSV record and send API requests
async function processRecord(record, template) {
    const results = [];
    const transactionOrderNumbers = [];
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
    
    // Helper function to create JSON and send request
    async function createAndSendRequest(prepaymentReq, zsfnVal, testId) {
        const jsonBody = createJSONBody(template, prepaymentReq, zsfnVal, testId);
        results.push(jsonBody);
        
        try {
            console.log(`    Sending request for TestID: ${testId}...`);
            const response = await sendRequest(jsonBody);
            
            if (response && response.TransactionOrderNumber) {
                transactionOrderNumbers.push(response.TransactionOrderNumber);
                console.log(`    ✅ Success: ${testId} - TransactionOrderNumber: ${response.TransactionOrderNumber}`);
            } else {
                transactionOrderNumbers.push('NO_TRANSACTION_NUMBER');
                console.log(`    ⚠️  Success but no TransactionOrderNumber: ${testId}`);
            }
            
            // Add small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
            
        } catch (error) {
            transactionOrderNumbers.push('ERROR');
            console.log(`    ❌ Failed: ${testId} - ${error.message}`);
        }
    }
    
    // Handle different scenarios for Generated Prepayment Request Number
    if (generatedPrepaymentNumber === null || generatedPrepaymentNumber === undefined || generatedPrepaymentNumber === '') {
        // Blank scenario: create one JSON with blank PrepaymentRequestnumber
        const testId = `TEST1ROUND_${originalPrepaymentNumber}1`;
        const zsfn = zsfnValues.length > 0 ? zsfnValues[0] : null;
        await createAndSendRequest('', zsfn, testId);
        
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
                await createAndSendRequest('', zsfn, testId);
            }
        } else {
            // Has actual values separated by commas
            // Check if all values are the same
            const uniqueValues = [...new Set(nonEmptyParts)];
            
            if (uniqueValues.length === 1) {
                // All values are the same, add incremental numbers
                const baseValue = uniqueValues[0];
                for (let index = 0; index < nonEmptyParts.length; index++) {
                    const testId = `TEST1ROUND_${baseValue}${index + 1}`;
                    const zsfn = zsfnValues[index] || zsfnValues[0] || null;
                    await createAndSendRequest(uniqueValues[0], zsfn, testId);
                }
            } else {
                // Values are different, use as is
                for (let index = 0; index < nonEmptyParts.length; index++) {
                    const part = nonEmptyParts[index];
                    const testId = `TEST1ROUND_${part}`;
                    const zsfn = zsfnValues[index] || zsfnValues[0] || null;
                    await createAndSendRequest(part, zsfn, testId);
                }
            }
        }
        
    } else {
        // Single value scenario
        const testId = `TEST1ROUND_${generatedPrepaymentNumber}`;
        const zsfn = zsfnValues.length > 0 ? zsfnValues[0] : null;
        await createAndSendRequest(generatedPrepaymentNumber, zsfn, testId);
    }
    
    // Concatenate TransactionOrderNumbers with comma delimiter
    const transactionOrderNumbersString = transactionOrderNumbers.join(', ');
    
    return { 
        jsonBodies: results, 
        transactionOrderNumbers: transactionOrderNumbersString 
    };
}

// Main function
async function main() {
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
        
        // Create output directories
        const outputDir = path.join(__dirname, 'output');
        
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        // Process each company group
        let totalJsonsCreated = 0;
        let totalRequestsSent = 0;
        let totalSuccessfulRequests = 0;
        const updatedCsvRecords = [];
        
        for (const companyCode of Object.keys(recordsByCompany)) {
            console.log(`\nProcessing company: ${companyCode}`);
            
            try {
                const template = loadTemplate(companyCode);
                const records = recordsByCompany[companyCode];
                const allJsonBodies = [];
                
                // Process each record and send API requests
                for (let index = 0; index < records.length; index++) {
                    const record = records[index];
                    console.log(`  Processing record ${index + 1}/${records.length}...`);
                    
                    const { jsonBodies, transactionOrderNumbers } = await processRecord(record, template);
                    
                    // Add JSONs to collection
                    allJsonBodies.push(...jsonBodies);
                    
                    // Add TransactionOrderNumbers column to the record
                    const updatedRecord = {
                        ...record,
                        'TransactionOrderNumbers': transactionOrderNumbers
                    };
                    updatedCsvRecords.push(updatedRecord);
                    
                    console.log(`  Record ${index + 1}: Generated ${jsonBodies.length} JSON(s), TransactionOrderNumbers: ${transactionOrderNumbers}`);
                    
                    totalJsonsCreated += jsonBodies.length;
                    totalRequestsSent += jsonBodies.length;
                    
                    // Count successful requests (those that don't have 'ERROR')
                    const successCount = transactionOrderNumbers.split(', ').filter(num => num !== 'ERROR').length;
                    totalSuccessfulRequests += successCount;
                }
                
                // Save JSON bodies to output folder
                const outputFilePath = path.join(outputDir, `${companyCode}_generated.json`);
                fs.writeFileSync(outputFilePath, JSON.stringify(allJsonBodies, null, 2));
                
                console.log(`  Total JSONs created for ${companyCode}: ${allJsonBodies.length}`);
                console.log(`  JSON output written to: ${outputFilePath}`);
                
            } catch (error) {
                console.error(`Error processing company ${companyCode}:`, error.message);
            }
        }
        
        // Save updated CSV with TransactionOrderNumbers column
        const updatedCsvPath = path.join(__dirname, 'processing-results-updated.csv');
        const updatedCsv = Papa.unparse(updatedCsvRecords, {
            header: true,
            quotes: true
        });
        fs.writeFileSync(updatedCsvPath, updatedCsv, 'utf8');
        
        console.log(`\n=== Summary ===`);
        console.log(`Total records processed: ${cleanedData.length}`);
        console.log(`Total JSON bodies created: ${totalJsonsCreated}`);
        console.log(`Total API requests sent: ${totalRequestsSent}`);
        console.log(`Successful API requests: ${totalSuccessfulRequests}`);
        console.log(`Failed API requests: ${totalRequestsSent - totalSuccessfulRequests}`);
        console.log(`JSON output directory: ${outputDir}`);
        console.log(`Updated CSV saved to: ${updatedCsvPath}`);
        
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main, processRecord, createJSONBody };