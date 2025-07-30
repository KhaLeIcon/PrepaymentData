const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Load configuration from config.yaml
const config = yaml.parse(fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8'));
const companies = config.Company;

// Initialize local counters (don't modify the original config)
let counters = {
  UnderDelivery: {
    TotalHappy: config.UnderDelivery.TotalHappy,
    TotalNoPrepayment: config.UnderDelivery.TotalNoPrepayment,
    TotalDiffPrepayment: config.UnderDelivery.TotalDiffPrepayment
  },
  OverDelivery: {
    TotalHappy: config.OverDelivery.TotalHappy,
    TotalNoPrepayment: config.OverDelivery.TotalNoPrepayment,
    TotalDiffPrepayment: config.OverDelivery.TotalDiffPrepayment
  },
  TotalOneToOne: config.TotalOneToOne,
  TotalOneToMany: config.TotalOneToMany
};

// Array to store all results for saving to file
let allResults = [];
let logOutput = [];

// Function to get available cases
function getAvailableCases() {
  const cases = [];
  
  if (counters.UnderDelivery.TotalHappy > 0) cases.push('UnderDelivery-Happy');
  if (counters.UnderDelivery.TotalNoPrepayment > 0) cases.push('UnderDelivery-NoPrepayment');
  if (counters.UnderDelivery.TotalDiffPrepayment > 0) cases.push('UnderDelivery-DiffPrepayment');
  if (counters.OverDelivery.TotalHappy > 0) cases.push('OverDelivery-Happy');
  if (counters.OverDelivery.TotalNoPrepayment > 0) cases.push('OverDelivery-NoPrepayment');
  if (counters.OverDelivery.TotalDiffPrepayment > 0) cases.push('OverDelivery-DiffPrepayment');
  
  return cases;
}

// Function to get available scenarios
function getAvailableScenarios() {
  const scenarios = [];
  
  if (counters.TotalOneToOne > 0) scenarios.push('OneToOne');
  if (counters.TotalOneToMany > 0) scenarios.push('OneToMany');
  
  return scenarios;
}

// Function to randomly select from array
function randomSelect(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Function to generate random number between min and max (inclusive)
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to generate ZFSN values based on case, scenario, amount, and oneToMany number
function generateZFSN(assignedCase, assignedScenario, amount, oneToManyNumber) {
  const [delivery, type] = assignedCase.split('-');
  
  if (delivery === 'UnderDelivery' && assignedScenario === 'OneToOne') {
    // One random number equal or smaller than amount
    return [randomBetween(1, amount)];
  } else if (delivery === 'OverDelivery' && assignedScenario === 'OneToOne') {
    // One random number larger than amount
    return [randomBetween(amount + 1, amount + 1000)];
  } else if (delivery === 'OverDelivery' && assignedScenario === 'OneToMany') {
    // Multiple random numbers where sum is larger than amount
    const numbers = [];
    let sum = 0;
    
    // Generate numbers that sum to at least amount + 1
    for (let i = 0; i < oneToManyNumber - 1; i++) {
      const num = randomBetween(1, Math.floor(amount / oneToManyNumber) + 100);
      numbers.push(num);
      sum += num;
    }
    
    // Last number ensures sum is larger than amount
    const lastNumber = randomBetween(amount - sum + 1, amount - sum + 500);
    numbers.push(lastNumber);
    
    return numbers;
  } else if (delivery === 'UnderDelivery' && assignedScenario === 'OneToMany') {
    // Multiple random numbers where sum is less than amount
    const numbers = [];
    let sum = 0;
    const targetSum = randomBetween(1, amount - 1);
    
    for (let i = 0; i < oneToManyNumber - 1; i++) {
      const maxForThisNumber = Math.floor((targetSum - sum) / (oneToManyNumber - i));
      const num = randomBetween(1, Math.max(1, maxForThisNumber));
      numbers.push(num);
      sum += num;
    }
    
    // Last number to reach target sum (less than amount)
    const lastNumber = Math.max(1, targetSum - sum);
    numbers.push(lastNumber);
    
    return numbers;
  }
  
  return [];
}

// Function to decrease counter based on selected case
function decreaseCounter(selectedCase) {
  const [delivery, type] = selectedCase.split('-');
  
  if (delivery === 'UnderDelivery') {
    if (type === 'Happy') counters.UnderDelivery.TotalHappy--;
    else if (type === 'NoPrepayment') counters.UnderDelivery.TotalNoPrepayment--;
    else if (type === 'DiffPrepayment') counters.UnderDelivery.TotalDiffPrepayment--;
  } else if (delivery === 'OverDelivery') {
    if (type === 'Happy') counters.OverDelivery.TotalHappy--;
    else if (type === 'NoPrepayment') counters.OverDelivery.TotalNoPrepayment--;
    else if (type === 'DiffPrepayment') counters.OverDelivery.TotalDiffPrepayment--;
  }
}

// Function to decrease scenario counter
function decreaseScenarioCounter(scenario) {
  if (scenario === 'OneToOne') {
    counters.TotalOneToOne--;
  } else if (scenario === 'OneToMany') {
    counters.TotalOneToMany--;
  }
}

// Function to process records for a company
function processCompanyRecords(companyCode, companyData, dataSource) {
  const sectionHeader = `\n=== Processing ${companyCode} from ${dataSource} ===`;
  const soInfo = `SO Number: ${companyData.SoNumber}`;
  const recordCount = `Total Records: ${companyData.Records.length}`;
  const separator = '---';
  
  console.log(sectionHeader);
  console.log(soInfo);
  console.log(recordCount);
  console.log(separator);
  
  // Add to log output
  logOutput.push(sectionHeader);
  logOutput.push(soInfo);
  logOutput.push(recordCount);
  logOutput.push(separator);
  
  companyData.Records.forEach((record, index) => {
    const availableCases = getAvailableCases();
    const availableScenarios = getAvailableScenarios();
    
    if (availableCases.length === 0 || availableScenarios.length === 0) {
      const message = `Record ${index + 1} (${record.BillingNumber}): No more cases or scenarios available`;
      console.log(message);
      logOutput.push(message);
      
      // Add to results array even if no assignment
      allResults.push({
        companyCode,
        dataSource,
        soNumber: companyData.SoNumber,
        recordIndex: index + 1,
        billingNumber: record.BillingNumber,
        prepaymentRequestNumber: record.PrepaymentRequestnumber,
        amount: record.Amount,
        assignedCase: 'N/A - No cases available',
        assignedScenario: 'N/A - No scenarios available',
        oneToManyNumber: null,
        zfsn: '',
        processed: false
      });
      return;
    }
    
    // Randomly select case and scenario
    const selectedCase = randomSelect(availableCases);
    const selectedScenario = randomSelect(availableScenarios);
    
    // Generate number for OneToMany if applicable
    let oneToManyNumber = null;
    if (selectedScenario === 'OneToMany') {
      oneToManyNumber = randomBetween(2, config.MaxNumberOneToMany);
    }
    
    // Generate ZFSN values
    const zfsnValues = generateZFSN(selectedCase, selectedScenario, record.Amount, oneToManyNumber);
    const zfsnString = zfsnValues.join(', ');
    
    // Decrease counters
    decreaseCounter(selectedCase);
    decreaseScenarioCounter(selectedScenario);
    
    // Create result message
    const resultMessage = `Record ${index + 1} (${record.BillingNumber}): ${selectedCase} - ${selectedScenario}${oneToManyNumber ? ` (${oneToManyNumber})` : ''} - ZFSN: ${zfsnString}`;
    console.log(resultMessage);
    logOutput.push(resultMessage);
    
    // Add to results array
    allResults.push({
      companyCode,
      dataSource,
      soNumber: companyData.SoNumber,
      recordIndex: index + 1,
      billingNumber: record.BillingNumber,
      prepaymentRequestNumber: record.PrepaymentRequestnumber,
      amount: record.Amount,
      assignedCase: selectedCase,
      assignedScenario: selectedScenario,
      oneToManyNumber: oneToManyNumber,
      zfsn: zfsnString,
      processed: true
    });
  });
}

// Function to save results to files
function saveResultsToFiles() {
  try {
    
    // Save CSV for easy spreadsheet viewing
    const csvFilename = `processing-results.csv`;
    const csvHeaders = 'Company Code,Data Source,SO Number,Record Index,Billing Number,Prepayment Request Number,Amount,Assigned Case,Assigned Scenario,OneToMany Number,ZFSN,Processed\n';
    const csvRows = allResults.map(r => 
      `${r.companyCode},${r.dataSource},${r.soNumber},${r.recordIndex},${r.billingNumber},${r.prepaymentRequestNumber},${r.amount},"${r.assignedCase}","${r.assignedScenario}",${r.oneToManyNumber || ''},"${r.zfsn || ''}",${r.processed}`
    ).join('\n');
    const csvContent = csvHeaders + csvRows;
    
    fs.writeFileSync(path.join(__dirname, csvFilename), csvContent);
    console.log(`✅ CSV results saved to: ${csvFilename}`);
    
  } catch (error) {
    console.error('Error saving results to files:', error);
  }
}
function processAllRecords() {
  try {
    console.log('Loaded configuration from config.yaml:');
    console.log(JSON.stringify(config, null, 2));
    
    // Read JSON files
    const localData = JSON.parse(fs.readFileSync(path.join(__dirname, 'local.json'), 'utf8'));
    const usdData = JSON.parse(fs.readFileSync(path.join(__dirname, 'USD.json'), 'utf8'));
    
    console.log('\nStarting record processing...');
    console.log(`\nInitial counters:`);
    console.log(JSON.stringify(counters, null, 2));
    
    // Process all companies from both files
    companies.forEach(companyCode => {
      // Process local data
      if (localData[companyCode]) {
        processCompanyRecords(companyCode, localData[companyCode], 'LOCAL');
      }
      
      // Process USD data
      if (usdData[companyCode]) {
        processCompanyRecords(companyCode, usdData[companyCode], 'USD');
      }
    });
    
    console.log('\n=== Final Counters ===');
    console.log(JSON.stringify(counters, null, 2));
    
    console.log('\n=== Summary ===');
    const totalProcessed = (config.UnderDelivery.TotalHappy + config.UnderDelivery.TotalNoPrepayment + config.UnderDelivery.TotalDiffPrepayment +
                           config.OverDelivery.TotalHappy + config.OverDelivery.TotalNoPrepayment + config.OverDelivery.TotalDiffPrepayment) -
                          (counters.UnderDelivery.TotalHappy + counters.UnderDelivery.TotalNoPrepayment + counters.UnderDelivery.TotalDiffPrepayment +
                           counters.OverDelivery.TotalHappy + counters.OverDelivery.TotalNoPrepayment + counters.OverDelivery.TotalDiffPrepayment);
    
    const totalScenariosUsed = (config.TotalOneToOne + config.TotalOneToMany) - (counters.TotalOneToOne + counters.TotalOneToMany);
    
    console.log(`Total records processed: ${totalProcessed}`);
    console.log(`Total scenarios used: ${totalScenariosUsed}`);
    saveResultsToFiles()
    
  } catch (error) {
    console.error('Error processing records:', error);
    if (error.code === 'ENOENT') {
      console.error('Make sure config.yaml, local.json, and USD.json files are in the same directory as this script');
    }
  }
}

// Run the processing
processAllRecords();