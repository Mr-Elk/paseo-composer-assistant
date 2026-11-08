#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const VERSION = "0.15.0";
const MARKER = "plugin-composer-status";

function fail(message) {
  throw new Error(message);
}

function parse(argv) {
  const options = { command: argv[0], install: "", artifact: "", confirm: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--install" || arg === "--artifact") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) fail(`${arg} 需要目录路径`);
      options[arg.slice(2)] = value;
    } else if (arg === "--confirm") options.confirm = true;
    else fail(`无法识别参数：${arg}`);
  }
  if (!["status", "apply", "restore"].includes(options.command) || !options.install) {
    fail("用法：status --install <目录> | apply --install <目录> --artifact <网页目录> --confirm | restore --install <目录> --confirm");
  }
  if (options.command !== "status" && !options.confirm) fail("修改安装目录需要显式提供 --confirm");
  return options;
}

function paths(install) {
  const root = resolve(install);
  const packageFile = join(root, "node_modules/@getpaseo/server/package.json");
  const webUi = join(root, "node_modules/@getpaseo/server/dist/server/web-ui");
  if (!existsSync(packageFile)) fail("找不到 @getpaseo/server；请确认安装目录");
  const version = JSON.parse(readFileSync(packageFile, "utf8")).version;
  if (version !== VERSION) fail(`Paseo server 版本为 ${version}；此补丁只支持 ${VERSION}`);
  return { root, version, webUi, backup: `${webUi}.original` };
}

function isDirectory(value) {
  return existsSync(value) && lstatSync(value).isDirectory();
}

function bridgePresent(webUi) {
  const jsDir = join(webUi, "_expo/static/js/web");
  if (!isDirectory(jsDir)) return false;
  return readdirSync(jsDir).some((name) => {
    const file = join(jsDir, name);
    return name.startsWith("index-") && name.endsWith(".js") &&
      lstatSync(file).isFile() && readFileSync(file, "utf8").includes(MARKER);
  });
}

/** Compare file names and contents before reusing an existing backup. */
function treeHash(root) {
  if (!isDirectory(root)) fail(`不是普通目录：${root}`);
  const hash = createHash("sha256");
  function walk(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(full);
      if (info.isDirectory()) {
        hash.update(`d\0${relative}\0`);
        walk(full, relative);
      } else if (info.isFile()) {
        hash.update(`f\0${relative}\0${info.size}\0`);
        hash.update(readFileSync(full));
      } else fail(`网页目录包含非常规文件：${relative}`);
    }
  }
  walk(root, "");
  return hash.digest("hex");
}

function swap(source, destination, oldPath, keepOld) {
  const incoming = `${destination}.incoming-${randomUUID()}`;
  if (existsSync(incoming) || existsSync(oldPath)) fail("临时目录已存在，未修改安装");
  try {
    cpSync(source, incoming, { recursive: true, force: false, errorOnExist: true });
    if (isDirectory(destination)) {
      renameSync(destination, oldPath);
      try {
        renameSync(incoming, destination);
      } catch (error) {
        renameSync(oldPath, destination);
        throw error;
      }
      if (!keepOld) {
        try { rmSync(oldPath, { recursive: true }); }
        catch { console.error(`旧网页保留在 ${oldPath}，请稍后检查。`); }
      }
    } else {
      if (existsSync(destination)) fail("网页目标不是普通目录，未修改安装");
      renameSync(incoming, destination);
    }
  } finally {
    if (existsSync(incoming)) rmSync(incoming, { recursive: true, force: true });
  }
}

function run(options) {
  const target = paths(options.install);
  if (options.command === "status") {
    console.log(JSON.stringify({
      version: target.version,
      webUiAvailable: isDirectory(target.webUi),
      patched: bridgePresent(target.webUi),
      backup: isDirectory(target.backup),
      backupPatched: bridgePresent(target.backup),
    }, null, 2));
    return;
  }
  if (options.command === "apply") {
    if (!options.artifact) fail("apply 需要 --artifact <网页目录>");
    const artifact = resolve(options.artifact);
    const artifactHash = treeHash(artifact);
    if (!bridgePresent(artifact)) fail("网页产物缺少草稿桥标记，未修改安装");
    if (!isDirectory(target.webUi)) fail("找不到原网页目录，未修改安装");
    if (bridgePresent(target.webUi)) {
      if (!isDirectory(target.backup) || bridgePresent(target.backup)) {
        fail("已有补丁但找不到可确认的原网页备份；未修改安装");
      }
      treeHash(target.backup);
      if (treeHash(target.webUi) === artifactHash) {
        console.log("当前网页已是此补丁；没有重复替换或覆盖备份。");
        return;
      }
      swap(artifact, target.webUi, `${target.webUi}.previous-${randomUUID()}`, false);
      console.log("已更新网页补丁；原网页备份保持不变。刷新页面后生效。");
      return;
    }
    const backupExists = existsSync(target.backup);
    if (backupExists && (!isDirectory(target.backup) || treeHash(target.backup) !== treeHash(target.webUi))) {
      fail("已有备份与当前网页不一致；请先核对备份，未修改安装");
    }
    const old = backupExists ? `${target.webUi}.previous-${randomUUID()}` : target.backup;
    swap(artifact, target.webUi, old, !backupExists);
    console.log("已应用网页补丁；备份保留在 web-ui.original。刷新页面后生效。");
    return;
  }
  if (!isDirectory(target.backup) || bridgePresent(target.backup)) {
    fail("找不到可确认的原网页备份；未修改安装");
  }
  treeHash(target.backup);
  swap(target.backup, target.webUi, `${target.webUi}.previous-${randomUUID()}`, false);
  console.log("已恢复原网页；备份仍保留。刷新页面后生效。");
}

try {
  run(parse(process.argv.slice(2)));
} catch (error) {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
