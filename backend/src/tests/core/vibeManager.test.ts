import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { VibeManager } from "../../core/vibeManager";
import * as fs from "fs/promises";
import * as path from "path";

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const TEST_TEMPLATE_PATH = path.join(FIXTURE_DIR, "template.test.html");
const ORIGINAL_TEMPLATE_PATH = path.join(__dirname, "../../core/template.html");

describe("VibeManager", () => {
  beforeAll(async () => {
    // Create a fixtures directory if it doesn't exist
    try {
      await fs.mkdir(FIXTURE_DIR, { recursive: true });
    } catch (e) {
      // Ignore if it already exists
    }

    // copy template.html to a safe test-specific fixture so we don't overwrite the original
    await fs.copyFile(ORIGINAL_TEMPLATE_PATH, TEST_TEMPLATE_PATH);
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.unlink(TEST_TEMPLATE_PATH);
    } catch (e) {
      // Ignore errors during cleanup
    }
  });

  test("should extract the existing theme", async () => {
    const manager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const theme = manager.getTheme();
    
    expect(theme).toContain("--vibe-primary: #3b82f6;");
    expect(theme).toContain("--vibe-bg: #0f172a;");
  });

  test("should overwrite the theme", async () => {
    const manager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const newTheme = `
        :root {
            --vibe-primary: #ff4500;
            --vibe-secondary: #ff8c00;
            --vibe-bg: #1a1a1a;
            --vibe-text: #ffffff;
            --vibe-accent: #ffd700;
            --vibe-font: 'Arial', sans-serif;
        }
    `;
    await manager.setTheme(newTheme);

    // Verify in a fresh instance to ensure it saved to disk
    const freshManager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const savedTheme = freshManager.getTheme();
    expect(savedTheme).toContain("--vibe-primary: #ff4500;");
    expect(savedTheme).toContain("--vibe-bg: #1a1a1a;");
  });

  test("should overwrite an existing slide", async () => {
    const manager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const slide1InnerHtml = `
      <div class="slide-aspect-ratio-box">
          <h1>Modified Slide 1</h1>
      </div>
    `;
    await manager.setSlide(1, slide1InnerHtml);

    const freshManager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const savedSlide = freshManager.getSlide(1);
    expect(savedSlide).toContain("<h1>Modified Slide 1</h1>");
    expect(savedSlide).not.toContain("<section");
  });

  test("should append a new slide sequentially", async () => {
    const manager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const newSlideHtml = `
      <section class="slide">
          <div class="slide-aspect-ratio-box">
              <h1>Injected Slide 2</h1>
          </div>
      </section>
    `;
    await manager.addSlide(newSlideHtml);

    const freshManager = await VibeManager.create(TEST_TEMPLATE_PATH);
    const savedSlide = freshManager.getSlide(2);
    expect(savedSlide).toContain("<h1>Injected Slide 2</h1>");
    expect(savedSlide).not.toContain("<section");
  });

  test("should delete a slide", async () => {
    const manager = await VibeManager.create(TEST_TEMPLATE_PATH);
    
    // Slide 2 exists from the previous test
    expect(manager.getSlide(2)).not.toBeNull();
    
    await manager.deleteSlide(2);

    const freshManager = await VibeManager.create(TEST_TEMPLATE_PATH);
    expect(freshManager.getSlide(2)).toBeNull();
  });
});
