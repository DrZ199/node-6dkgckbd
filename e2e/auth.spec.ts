import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login form on initial load', async ({ page }) => {
    // Check for login form elements
    await expect(page.getByRole('heading', { name: 'Welcome to NelsonGPT' })).toBeVisible();
    await expect(page.getByPlaceholder('doctor@hospital.com')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('should show validation errors for invalid inputs', async ({ page }) => {
    // Try to submit empty form
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Check for validation errors
    await expect(page.getByText('Please enter a valid email address')).toBeVisible();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('should handle invalid login credentials', async ({ page }) => {
    // Fill in invalid credentials
    await page.getByPlaceholder('doctor@hospital.com').fill('invalid@example.com');
    await page.getByPlaceholder('Enter your password').fill('wrongpassword');
    
    // Submit form
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Check for error message
    await expect(page.getByText(/Invalid email or password/)).toBeVisible();
  });

  test('should toggle password visibility', async ({ page }) => {
    const passwordInput = page.getByPlaceholder('Enter your password');
    const toggleButton = page.getByRole('button', { name: /Show password|Hide password/ });
    
    // Initially password should be hidden
    await expect(passwordInput).toHaveAttribute('type', 'password');
    
    // Click toggle to show password
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    
    // Click toggle to hide password again
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('should navigate to signup form', async ({ page }) => {
    // Click signup link
    await page.getByRole('button', { name: 'Sign up here' }).click();
    
    // Should show signup form
    await expect(page.getByRole('heading', { name: 'Create Medical Account' })).toBeVisible();
    await expect(page.getByPlaceholder('Dr. John Smith')).toBeVisible();
    await expect(page.getByPlaceholder('MD123456')).toBeVisible();
  });

  test('should handle forgot password flow', async ({ page }) => {
    // Enter email
    await page.getByPlaceholder('doctor@hospital.com').fill('test@example.com');
    
    // Click forgot password
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    
    // Should show success message
    await expect(page.getByText(/Password reset email sent/)).toBeVisible();
  });

  test('should show MFA input when required', async ({ page }) => {
    // Mock API response for MFA requirement
    await page.route('**/auth/**', async route => {
      await route.fulfill({
        status: 400,
        body: JSON.stringify({ message: 'MFA code required' }),
      });
    });

    // Fill credentials
    await page.getByPlaceholder('doctor@hospital.com').fill('mfa@example.com');
    await page.getByPlaceholder('Enter your password').fill('password123');
    
    // Submit form
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Should show MFA input
    await expect(page.getByPlaceholder('Enter 6-digit code')).toBeVisible();
    await expect(page.getByText('Enter the 6-digit code from your authenticator app')).toBeVisible();
  });

  test('should display security notice', async ({ page }) => {
    await expect(page.getByText('Security Notice')).toBeVisible();
    await expect(page.getByText(/This application requires valid medical credentials/)).toBeVisible();
    await expect(page.getByText(/All access is logged for audit purposes/)).toBeVisible();
  });

  test('should handle rate limiting', async ({ page }) => {
    // Mock rate limit response
    await page.route('**/auth/**', async route => {
      await route.fulfill({
        status: 429,
        body: JSON.stringify({ message: 'Too many login attempts' }),
      });
    });

    // Fill credentials
    await page.getByPlaceholder('doctor@hospital.com').fill('test@example.com');
    await page.getByPlaceholder('Enter your password').fill('password123');
    
    // Submit form
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Should show rate limit error
    await expect(page.getByText(/Too many login attempts/)).toBeVisible();
  });
});

test.describe('Sign Up Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to signup form
    await page.getByRole('button', { name: 'Sign up here' }).click();
  });

  test('should display signup form with all required fields', async ({ page }) => {
    // Check for all required fields
    await expect(page.getByPlaceholder('Dr. John Smith')).toBeVisible();
    await expect(page.getByPlaceholder('doctor@hospital.com')).toBeVisible();
    await expect(page.getByPlaceholder('MD123456')).toBeVisible();
    await expect(page.getByPlaceholder('Children\'s Hospital')).toBeVisible();
    await expect(page.getByPlaceholder('Pediatrics')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Role' })).toBeVisible();
    await expect(page.getByPlaceholder('Create a strong password')).toBeVisible();
    await expect(page.getByPlaceholder('Confirm your password')).toBeVisible();
  });

  test('should validate medical credentials', async ({ page }) => {
    // Fill form with invalid license number
    await page.getByPlaceholder('Dr. John Smith').fill('Test User');
    await page.getByPlaceholder('doctor@hospital.com').fill('test@example.com');
    await page.getByPlaceholder('MD123456').fill('invalid');
    
    await page.getByRole('button', { name: 'Create Account' }).click();
    
    // Should show validation error
    await expect(page.getByText(/Please enter a valid medical license number/)).toBeVisible();
  });

  test('should validate password requirements', async ({ page }) => {
    // Fill passwords with weak password
    await page.getByPlaceholder('Create a strong password').fill('weak');
    await page.getByPlaceholder('Confirm your password').fill('weak');
    
    await page.getByRole('button', { name: 'Create Account' }).click();
    
    // Should show password requirements
    await expect(page.getByText(/Password must be at least 8 characters/)).toBeVisible();
  });

  test('should validate password confirmation', async ({ page }) => {
    // Fill mismatched passwords
    await page.getByPlaceholder('Create a strong password').fill('password123');
    await page.getByPlaceholder('Confirm your password').fill('password456');
    
    await page.getByRole('button', { name: 'Create Account' }).click();
    
    // Should show mismatch error
    await expect(page.getByText(/Passwords do not match/)).toBeVisible();
  });

  test('should require HIPAA training agreement', async ({ page }) => {
    // Fill valid form but don't check HIPAA agreement
    await page.getByPlaceholder('Dr. John Smith').fill('Dr. Test User');
    await page.getByPlaceholder('doctor@hospital.com').fill('test@example.com');
    await page.getByPlaceholder('MD123456').fill('MD123456');
    await page.getByPlaceholder('Children\'s Hospital').fill('Test Hospital');
    await page.getByPlaceholder('Pediatrics').fill('Pediatrics');
    await page.getByRole('combobox', { name: 'Role' }).selectOption('physician');
    await page.getByPlaceholder('Create a strong password').fill('securepassword123');
    await page.getByPlaceholder('Confirm your password').fill('securepassword123');
    
    await page.getByRole('button', { name: 'Create Account' }).click();
    
    // Should show HIPAA agreement error
    await expect(page.getByText(/You must acknowledge HIPAA training requirements/)).toBeVisible();
  });
});

test.describe('Medical Safety Features', () => {
  test('should display medical disclaimers prominently', async ({ page }) => {
    await page.goto('/');
    
    // Check for medical disclaimers
    await expect(page.getByText(/This application requires valid medical credentials/)).toBeVisible();
    await expect(page.getByText(/All access is logged for audit purposes/)).toBeVisible();
  });

  test('should require medical license validation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign up here' }).click();
    
    // Try signup without license number
    await page.getByPlaceholder('Dr. John Smith').fill('Test User');
    await page.getByPlaceholder('doctor@hospital.com').fill('test@example.com');
    // Skip license number
    await page.getByPlaceholder('Children\'s Hospital').fill('Test Hospital');
    
    await page.getByRole('button', { name: 'Create Account' }).click();
    
    // Should require license number
    await expect(page.getByText(/Medical license number is required/)).toBeVisible();
  });

  test('should validate institutional affiliation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign up here' }).click();
    
    // Try signup without institution
    await page.getByPlaceholder('Dr. John Smith').fill('Dr. Test User');
    await page.getByPlaceholder('doctor@hospital.com').fill('test@example.com');
    await page.getByPlaceholder('MD123456').fill('MD123456');
    // Skip institution
    
    await page.getByRole('button', { name: 'Create Account' }).click();
    
    // Should require institution
    await expect(page.getByText(/Institution is required/)).toBeVisible();
  });
});

test.describe('Mobile Responsiveness', () => {
  test('should be responsive on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Check if form is properly displayed on mobile
    await expect(page.getByRole('heading', { name: 'Welcome to NelsonGPT' })).toBeVisible();
    await expect(page.getByPlaceholder('doctor@hospital.com')).toBeVisible();
    
    // Check if buttons are touch-friendly
    const signInButton = page.getByRole('button', { name: 'Sign In' });
    const buttonBox = await signInButton.boundingBox();
    expect(buttonBox?.height).toBeGreaterThan(40); // Minimum touch target size
  });

  test('should handle touch interactions', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Test touch interactions
    await page.getByPlaceholder('Enter your password').tap();
    await page.getByRole('button', { name: /Show password/ }).tap();
    
    // Password should be visible
    await expect(page.getByPlaceholder('Enter your password')).toHaveAttribute('type', 'text');
  });
});