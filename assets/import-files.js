/* The catalog is the final file committed by a local import. */
(() => {
  "use strict";

  const catalogPath = "data/catalog.json";
  const encoder = new TextEncoder();

  function parseCatalog(text) {
    const catalog = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!catalog || !["models", "topics", "entries"].every(key => Array.isArray(catalog[key]))) {
      throw new Error("目录需要包含 models、topics 和 entries 三个数组。");
    }
    return catalog;
  }

  async function locate(root, path, create = false) {
    const parts = path.split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part.includes("\\"))) {
      throw new Error("目录中含有无效的文件路径。");
    }
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    const name = parts[parts.length - 1];
    return { dir, name, handle: await dir.getFileHandle(name, { create }) };
  }

  async function catalogText(root) {
    const { handle } = await locate(root, catalogPath);
    return (await handle.getFile()).text();
  }

  async function write(handle, content) {
    const stream = await handle.createWritable();
    try {
      await stream.write(content);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }

  async function commit(root, buildFiles) {
    const original = await catalogText(root);
    const files = buildFiles(parseCatalog(original));
    const changes = [];
    try {
      for (const [path, content] of files) {
        if (path === catalogPath && await catalogText(root) !== original) {
          throw new Error("目录已被其他窗口修改。请再次保存，以合并最新目录。");
        }
        let target;
        let previous = null;
        try {
          target = await locate(root, path);
          // A File from this API may become unreadable once its source is modified.
          previous = await (await target.handle.getFile()).arrayBuffer();
        } catch (error) {
          if (error.name !== "NotFoundError") throw error;
          target = await locate(root, path, true);
        }
        const change = { target, previous, content, closed: false };
        changes.push(change);
        await write(target.handle, content);
        change.closed = true;
      }
    } catch (error) {
      let rollbackFailed = false;
      for (const change of changes.reverse()) {
        try {
          const { target, previous, content, closed } = change;
          if (!closed && previous !== null) continue;
          const current = await (await target.handle.getFile()).text();
          if (current !== (closed ? content : "")) continue;
          if (previous === null) await target.dir.removeEntry(target.name);
          else await write(target.handle, previous);
        } catch {
          rollbackFailed = true;
        }
      }
      if (rollbackFailed) throw new Error("写入中断。请检查所选目录中的正文、提示词和 catalog.json，再重试。");
      throw error;
    }
  }

  function save(root, buildFiles) {
    const run = () => commit(root, buildFiles);
    return navigator.locks ? navigator.locks.request("novellaarena-import", run) : run();
  }

  // ZIP's stored method keeps these small UTF-8 files portable without a library.
  const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc;
  });

  function zip(files) {
    const contents = [];
    const directory = [];
    let offset = 0;
    let directorySize = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >>> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const [path, text] of files) {
      const name = encoder.encode(path);
      const data = encoder.encode(text);
      let crc = 0xffffffff;
      for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, ~crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      new Uint8Array(central.buffer, 6, 26).set(new Uint8Array(local.buffer, 4));
      central.setUint32(42, offset, true);
      contents.push(local, name, data);
      directory.push(central, name);
      offset += 30 + name.length + data.length;
      directorySize += 46 + name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.size, true);
    end.setUint16(10, files.size, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return new Blob([...contents, ...directory, end], { type: "application/zip" });
  }

  window.ArenaImportFiles = { catalogPath, catalogText, parseCatalog, save, zip };
})();
