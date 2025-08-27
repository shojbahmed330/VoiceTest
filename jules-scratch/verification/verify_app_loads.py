from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # 1. Navigate to the application's URL.
            page.goto("http://localhost:5173/")

            # 2. Wait for a fixed amount of time for the page to load.
            #    This is not a best practice, but it's a fallback when
            #    it's difficult to predict the page content.
            print("Waiting for 5 seconds for the page to load...")
            page.wait_for_timeout(5000)
            print("Waited for 5 seconds.")

            # 3. Take a screenshot for visual verification.
            page.screenshot(path="jules-scratch/verification/verification.png")
            print("Screenshot taken successfully.")

        except Exception as e:
            print(f"An error occurred during Playwright verification: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()
