const fs = require("fs");
const path = require("path");

function run() {
  try {
    const dest = path.join(__dirname, "index-CAipmyyE.js");
    if (!fs.existsSync(dest)) {
      console.log("Bundle file not found.");
      return;
    }

    const content = fs.readFileSync(dest, "utf-8");

    // Search for slowMode references in the bundle
    let idx = 0;
    while ((idx = content.indexOf("slowMode", idx)) !== -1) {
      console.log(`\nMatch 'slowMode' at index ${idx}:`);
      console.log(content.substring(idx - 150, idx + 150));
      idx += 8;
    }

    // Let's search for "settings" or `/settings` or `/update` on docks
    let sIdx = 0;
    while ((sIdx = content.indexOf("/settings", sIdx)) !== -1) {
      console.log(`\nMatch '/settings' at index ${sIdx}:`);
      console.log(content.substring(sIdx - 100, sIdx + 100));
      sIdx += 9;
    }

  } catch (e) {
    console.error(e.message);
  }
}

run();
