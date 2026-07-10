const { runTypeChain, glob } = require('typechain');

async function main() {
  const cwd = process.cwd();
  // find all files matching the glob
  const allFiles = glob(cwd, [`./src/constants/abis/**/+([a-zA-Z0-9_]).json`]);

	console.log('running typechain...')
  const result = await runTypeChain({
    cwd,
    filesToProcess: allFiles,
    allFiles,
    outDir: './types/contracts/',
    target: 'ethers-v5',
  });
	console.log('typechain results: ',result)
}

main().catch(console.error);
