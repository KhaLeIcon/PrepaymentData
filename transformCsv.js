const fs = require('fs');
const Papa = require('papaparse');

// Read the processing-results-updated.csv file
const csvData = fs.readFileSync('processing-results-updated.csv', 'utf8');

// Parse the CSV data
const parsed = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true
});

// Define the new column headers
const newHeaders = [
    'Reference Number (Prepayment SO)',
    'Sold to Party', 
    'Prepayment SO Number',
    'Prepayment SO Line Item Number',
    'Prepayment SO Amount',
    'Prepayment SO Currency',
    'Billing Document (Prepayment Tax Invoice)',
    'Reference Number (Delivery SO)',
    'Delivery SO Number',
    'Delivery SO Line Item Number', 
    'Delivery SO Amount',
    'Delivery SO Currency',
    'Amount to Apply',
    'Sales Organization',
    'Data Source',
    'Assigned Case',
    'Assigned Scenario',
    'Number Of Case'
];

const technicalHeaders = [
    'I_Salesdocument-YY1_PrepaymentReqNum',
    'I_Salesdocument - Soldtoparty',
    'I_Salesdocument-Salesdocument', 
    'I_Salesdocumentitem-Salesdocumentitem',
    'I_Salesdocumentitem-Netamount',
    'I_Salesdocument-Currency',
    'I_Billingdocument-Billingdocument',
    'I_Salesdocument-YY1_PrepaymentReqNum',
    'I_Salesdocument-Salesdocument',
    'I_Salesdocumentitem-Salesdocumentitem',
    'I_Salesdocumentitem-Netamount',
    'I_Salesdocument-Currency',
    'Customzed field (refer to field I_Salesdocumentitem-Netamount)',
    'I_Salesdocument-SALESORGANIZATION',
    'Data Source',
    'Assigned Case',
    'Assigned Scenario', 
    'Number Of Case'
];

// Function to determine currency based on company code
function getCurrency(companyCode) {
    const currencyMap = {
        'SAC1': 'SAR',
        'MAC1': 'MAD', 
        'EGC1': 'EGP'
    };
    return currencyMap[companyCode] || 'USD';
}

// Function to generate sold to party based on company code
function getSoldToParty(companyCode) {
    const soldToPartyMap = {
        'SAC1': 'HS58M1PTWJ',
        'MAC1': '4F32L8O0DG',
        'EGC1': '275554HENP'
    };
    return soldToPartyMap[companyCode] || 'Unknown';
}

// Function to process each row and handle different scenarios
function processRow(row) {
    const results = [];
    
    const assignedCase = row['Assigned Case'];
    const assignedScenario = row['Assigned Scenario'];
    const originalPrepaymentReq = row['Original Prepayment Request Number'];
    const generatedPrepaymentReqs = row['Generated Prepayment Request Number'] ? 
        row['Generated Prepayment Request Number'].split(', ').map(s => s.trim()) : [''];
    const deliveryAmounts = row['ZFSN'] ? 
        row['ZFSN'].split(', ').map(s => s.trim()) : [''];
    const transactionOrders = row['TransactionOrderNumbers'] ? 
        row['TransactionOrderNumbers'].split(', ').map(s => s.trim()) : [''];
    
    const baseData = {
        'Reference Number (Prepayment SO)': row['Original Prepayment Request Number'],
        'Sold to Party': getSoldToParty(row['Company Code']),
        'Prepayment SO Number': row['SO Number'],
        'Prepayment SO Line Item Number': (parseInt(row['Record Index']) * 10).toString(),
        'Prepayment SO Amount': row['Amount'],
        'Prepayment SO Currency': getCurrency(row['Company Code']),
        'Billing Document (Prepayment Tax Invoice)': row['Billing Number'],
        'Sales Organization': row['Company Code'],
        'Data Source': row['Data Source'],
        'Assigned Case': row['Assigned Case'],
        'Assigned Scenario': row['Assigned Scenario'],
        'Number Of Case': assignedScenario === 'OneToOne' ? '1' : row['OneToMany Number']
    };

    // Handle different scenarios
    if (assignedScenario === 'OneToOne') {
        // OneToOne scenario - single row
        const deliveryRefNum = generatedPrepaymentReqs[0] || '';
        const deliveryAmount = deliveryAmounts[0] || '';
        const deliveryOrder = transactionOrders[0] || '';
        
        results.push({
            ...baseData,
            'Reference Number (Delivery SO)': deliveryRefNum,
            'Delivery SO Number': deliveryOrder,
            'Delivery SO Line Item Number': '10',
            'Delivery SO Amount': deliveryAmount,
            'Delivery SO Currency': getCurrency(row['Company Code']),
            'Amount to Apply': deliveryAmount
        });
    } else if (assignedScenario === 'OneToMany') {
        // OneToMany scenario - multiple rows
        const isHappyScenario = assignedCase.includes('Happy');
        
        for (let i = 0; i < Math.max(generatedPrepaymentReqs.length, deliveryAmounts.length, transactionOrders.length); i++) {
            const deliveryRefNum = generatedPrepaymentReqs[i] || '';
            const deliveryAmount = deliveryAmounts[i] || '';
            const deliveryOrder = transactionOrders[i] || '';
            
            // For Happy scenarios, use original prepayment request number for delivery reference
            const finalDeliveryRefNum = (isHappyScenario && originalPrepaymentReq === deliveryRefNum) ? 
                originalPrepaymentReq : deliveryRefNum;
            
            results.push({
                ...baseData,
                'Reference Number (Delivery SO)': finalDeliveryRefNum,
                'Delivery SO Number': deliveryOrder,
                'Delivery SO Line Item Number': '10',
                'Delivery SO Amount': deliveryAmount,
                'Delivery SO Currency': getCurrency(row['Company Code']),
                'Amount to Apply': deliveryAmount
            });
        }
    }
    
    return results;
}

// Process all rows
const transformedData = [];
parsed.data.forEach(row => {
    if (row['Company Code']) { // Skip empty rows
        const processedRows = processRow(row);
        transformedData.push(...processedRows);
    }
});

// Create the final CSV structure
const finalData = [];

// Add headers
finalData.push(newHeaders);
finalData.push(technicalHeaders);

// Add transformed data
transformedData.forEach(row => {
    const csvRow = newHeaders.map(header => row[header] || '');
    finalData.push(csvRow);
});

// Convert to CSV format
const csvContent = Papa.unparse(finalData, {
    quotes: true,
    delimiter: ','
});

// Write to new file
fs.writeFileSync('transformed-prepayment-scenarios.csv', csvContent);

console.log('CSV transformation completed! Output saved to: transformed-prepayment-scenarios.csv');
console.log(`Processed ${transformedData.length} rows from ${parsed.data.length} original rows`);
