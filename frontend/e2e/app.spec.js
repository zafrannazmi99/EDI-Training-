import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const place = {
  id: 'node/123',
  name: 'Schlossgarten',
  place_type: 'Park',
  lat: 49.0142,
  lon: 8.4044,
  description: 'Schlossgarten is an OpenStreetMap-listed park near Karlsruhe.',
  tags: { leisure: 'park', name: 'Schlossgarten' },
  score: 0.86,
}

const trip = (id, name, places = []) => ({
  id,
  name,
  created_at: '2026-10-21T00:00:00Z',
  places,
})

async function stubExternalVisualAssets(page) {
  // Keep QA deterministic and avoid depending on tile/font CDNs.
  await page.route('https://**', async (route) => {
    const url = route.request().url()
    if (url.includes('tile.openstreetmap.org') || url.includes('marker-icon') || url.includes('marker-shadow')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQioAAAAASUVORK5CYII=', 'base64') })
    } else {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    }
  })
}

async function stubSearch(page) {
  await page.route('**/ask', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      answer: 'Schlossgarten is a nearby park that matches your request.',
      model_status: 'ollama',
      places: [place],
    }),
  }))
}

async function seriousAxeViolations(page) {
  const axePath = fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url))
  await page.addScriptTag({ path: axePath })
  const results = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }))
  return results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
}

test('loads discovery, searches, and displays a grounded place on the map', async ({ page }) => {
  const consoleErrors = []
  const failedLocalResponses = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:4173') && response.status() >= 400) {
      failedLocalResponses.push(`${response.status()} ${response.url()}`)
    }
  })
  await stubExternalVisualAssets(page)
  await stubSearch(page)
  await page.goto('/')

  await expect(page).toHaveTitle('Karlsruhe Hidden Gems')
  await expect(page.getByRole('heading', { name: /find your somewhere/i })).toBeVisible()
  await page.getByLabel('Describe your outing').fill('A quiet park for a slow afternoon')
  await page.getByRole('button', { name: 'Search places' }).click()
  await expect(page.getByText('Schlossgarten is a nearby park that matches your request.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Schlossgarten' })).toBeVisible()
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  expect(consoleErrors).toEqual([])
  expect(failedLocalResponses).toEqual([])
})

test('signs in, opens trips, creates a collection, and saves a result', async ({ page }) => {
  await stubExternalVisualAssets(page)
  await stubSearch(page)
  await page.route('**/auth/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'playwright-test-token',
      token_type: 'bearer',
      user: { id: 7, email: 'qa@example.test' },
    }),
  }))
  await page.route('**/trips', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(trip(1, 'A little outdoors')) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/trips/1/places', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(trip(1, 'A little outdoors', [{ ...place, id: 9, place_id: place.id }])),
  }))

  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByLabel('Email address').fill('not-an-email')
  await page.getByLabel('Password').fill('')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  expect(await page.getByLabel('Email address').evaluate((input) => input.checkValidity())).toBe(false)
  await page.getByLabel('Email address').fill('qa@example.test')
  await page.getByLabel('Password').fill('test-only-password')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: /my trips/i })).toBeVisible()

  await page.getByLabel('Describe your outing').fill('A quiet park for a slow afternoon')
  await page.getByRole('button', { name: 'Search places' }).click()
  await expect(page.getByRole('heading', { name: 'Schlossgarten' })).toBeVisible()
  await page.getByRole('button', { name: 'Save to a trip' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  await page.getByRole('button', { name: /my trips/i }).click()
  await expect(page.getByRole('heading', { name: 'Trips worth taking.' })).toBeVisible()
  await expect(page.getByText('A little outdoors')).toBeVisible()
  await expect(page.getByText('Schlossgarten')).toBeVisible()
})

test('fits phone, tablet, and desktop viewports without horizontal overflow', async ({ page }) => {
  await stubExternalVisualAssets(page)
  await page.goto('/')
  const sizes = [
    { name: 'phone', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 1000 },
  ]
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.screenshot({ path: `test-results/${size.name}.png`, fullPage: true })
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      mapPanelHeight: document.querySelector('.map-panel')?.getBoundingClientRect().height,
      mapShellHeight: document.querySelector('.map-shell')?.getBoundingClientRect().height,
      leafletHeight: document.querySelector('.leaflet-container')?.getBoundingClientRect().height,
    }))
    expect(dimensions.document, `${size.name} layout should not scroll horizontally`).toBeLessThanOrEqual(dimensions.viewport)
    expect(dimensions.pageHeight, `${size.name} page height should stay bounded`).toBeLessThan(size.height + 900)
    expect(dimensions.mapShellHeight, `${size.name} map height should stay bounded`).toBeLessThan(size.height + 200)
  }
})

test('has no serious or critical axe accessibility violations on discovery', async ({ page }) => {
  await stubExternalVisualAssets(page)
  await page.goto('/')
  const serious = await seriousAxeViolations(page)
  const summary = serious.flatMap((violation) => violation.nodes.map((node) => ({
    id: violation.id,
    selector: node.target.join(', '),
    message: node.any?.[0]?.message || node.failureSummary,
  })))
  expect(serious, JSON.stringify(summary, null, 2)).toEqual([])
})

test('has no serious or critical axe violations in sign-in and trips views', async ({ page }) => {
  await stubExternalVisualAssets(page)
  await page.route('**/auth/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'playwright-test-token',
      token_type: 'bearer',
      user: { id: 7, email: 'qa@example.test' },
    }),
  }))
  await page.route('**/trips', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  let serious = await seriousAxeViolations(page)
  expect(serious.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(', ')} — ${node.any?.[0]?.message || node.failureSummary}`))).toEqual([])

  await page.getByLabel('Email address').fill('qa@example.test')
  await page.getByLabel('Password').fill('test-only-password')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: /my trips/i }).click()
  await expect(page.getByRole('heading', { name: 'Trips worth taking.' })).toBeVisible()
  serious = await seriousAxeViolations(page)
  expect(serious.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(', ')} — ${node.any?.[0]?.message || node.failureSummary}`))).toEqual([])
})
