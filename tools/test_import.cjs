// Run with node --test tools/test_import.cjs. Uses the browser APIs built into Node 20+.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const browser = { window: {}, navigator: {}, Blob, TextEncoder };
const source = fs.readFileSync(path.join(__dirname, "../assets/import-files.js"), "utf8");
vm.runInNewContext(source, browser);
const { zip, save } = browser.window.ArenaImportFiles;

test("the ZIP stores UTF-8 paths, intact files and valid central-directory offsets", async () => {
  const files = new Map([["texts/题目.txt", "123456789"], ["prompts/题目.txt", "第二行\r\n"]]);
  const data = Buffer.from(await zip(files).arrayBuffer());
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  assert.equal(data.readUInt16LE(end + 10), files.size);
  let central = data.readUInt32LE(end + 16);
  for (const [name, expected] of files) {
    assert.equal(data.readUInt32LE(central), 0x02014b50);
    const length = data.readUInt16LE(central + 28);
    assert.equal(data.toString("utf8", central + 46, central + 46 + length), name);
    const local = data.readUInt32LE(central + 42);
    assert.equal(data.readUInt32LE(local), 0x04034b50);
    assert.equal(data.readUInt16LE(local + 6), 0x0800);
    if (expected === "123456789") assert.equal(data.readUInt32LE(local + 14), 0xcbf43926);
    const start = local + 30 + length;
    assert.equal(data.toString("utf8", start, start + data.readUInt32LE(local + 22)), expected);
    central += 46 + length;
  }
  assert.equal(central, end);
});

test("a catalog write failure restores existing bytes and removes a newly created prompt", async () => {
  const catalog = '{"models":[],"topics":[],"entries":[]}';
  const stored = new Map([["data/catalog.json", new Blob([catalog])], ["texts/原稿.txt", new Blob(["原稿\r\n"])]]);
  let fail = true;
  function directory(prefix) {
    return {
      getDirectoryHandle(name) { return directory(prefix + name + "/"); },
      removeEntry(name) { stored.delete(prefix + name); },
      getFileHandle(name, { create }) {
        const key = prefix + name;
        if (!stored.has(key)) {
          if (!create) throw new DOMException("Missing", "NotFoundError");
          stored.set(key, new Blob([]));
        }
        return {
          getFile() { return stored.get(key); },
          createWritable() {
            if (fail && key === "data/catalog.json") throw new Error("write interrupted");
            let content;
            return {
              write(value) { content = new Blob([value]); },
              close() { stored.set(key, content); },
              abort() { return Promise.resolve(); }
            };
          }
        };
      }
    };
  }
  const root = directory("");
  const build = () => new Map([["texts/原稿.txt", "修订"], ["prompts/新题.txt", "提示"], ["data/catalog.json", catalog + "\n"]]);
  await assert.rejects(save(root, build), /write interrupted/);
  assert.equal(await stored.get("texts/原稿.txt").text(), "原稿\r\n");
  assert.equal(await stored.get("data/catalog.json").text(), catalog);
  assert.equal(stored.has("prompts/新题.txt"), false);
  fail = false;
  await save(root, build);
  assert.equal(await stored.get("texts/原稿.txt").text(), "修订");
  assert.equal(await stored.get("prompts/新题.txt").text(), "提示");
});
