# E2E Tests Connectivity Fix

## Problem
The E2E tests job was hanging when attempting to connect to Firebase Hosting due to Playwright trying to start a local webServer while also connecting to a deployed Firebase URL.

## Solution
Updated `playwright.config.js` to:
1. Detect whether testing against Firebase URL vs localhost
2. Only start local webServer for localhost testing  
3. Add proper timeouts (30s test, 30s navigation, 10s action)
4. Skip webServer entirely when Firebase URL is provided

Updated `.github/workflows/firebase-deploy-and-test.yml` to:
1. Improve Firebase URL retrieval with fallback to main channel
2. Add URL accessibility verification with 5 retries (5s interval)
3. Add timeout-minutes (5 minutes) for E2E tests job
4. Better error handling and debugging output

## Result
E2E tests now connect directly to Firebase Hosting without attempting to start a local server, preventing the timeout/hang issue.
