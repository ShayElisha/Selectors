#!/usr/bin/env node
import { seedWorkerWindowsForAllOrgs } from '../server/data.js'

async function main() {
  console.log('Running worker window seeding...')
  const results = await seedWorkerWindowsForAllOrgs()
  
  console.log(`✓ Seeded ${results.seeded} org/module combinations`)
  console.log(`  Skipped ${results.skipped} (already have data)`)
  
  if (results.errors.length > 0) {
    console.error('✗ Errors:')
    results.errors.forEach(err => console.error('  -', err))
  }
  
  process.exit(results.errors.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
