export default { testDir: './t', timeout: 8000, retries: 0, reporter: [['json',{outputFile:'report.json'}],['line']], use: { trace: 'on', screenshot: 'only-on-failure', headless: true } };
