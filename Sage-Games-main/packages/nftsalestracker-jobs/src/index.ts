import transposeCrawler from './crawler-transpose'

async function main() {
  await transposeCrawler()
}

function exit(code: number) {
  process.exit(code)
}

main()
  .then(() => setTimeout(exit, 2000, 0))
  .catch((error) => {
    console.log(error)
    setTimeout(exit, 2000, 1)
  })
