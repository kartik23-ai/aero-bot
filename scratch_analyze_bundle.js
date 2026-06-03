const fs = require("fs");
const path = require("path");

function run() {
  try {
    const dest = path.join(__dirname, "index-CAipmyyE.js");
    if (!fs.existsSync(dest)) return;

    const content = fs.readFileSync(dest, "utf-8");

    let idx = 0;
    while ((idx = content.indexOf("newMessage", idx)) !== -1) {
      console.log(`\nMatch 'newMessage' at index ${idx}:`);
      console.log(content.substring(idx - 150, idx + 150));
      idx += 10;
    }

  } catch (e) {
    console.error(e.message);
  }
}

run();
