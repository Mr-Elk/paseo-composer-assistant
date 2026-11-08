# Paseo 0.15.0 网页草稿桥

此补丁为 Paseo 网页版增加安全草稿读写和输入框下方状态位。它不是 Paseo 官方接口，也不适用于原生手机 App。该补丁固定对应官方 `v0.15.0` 提交 `8938fde3c713143f12eacbdd60c11fdfc0be0fb1`，安装目标的 `@getpaseo/server` 也必须是 **0.15.0**。版本号相同并不保证安装包和源码完全一致；替换前请核对安装来源并保留备份。

补丁从源码构建网页，不包含预编译文件。Paseo 源码采用 Apache-2.0，版权及许可证见 [PASEO-LICENSE](PASEO-LICENSE)；本插件自己的代码采用仓库根目录的许可证。补丁 SHA-256：

```
26a6948c3a5ddc29b612285a1db140bc551c27c60da20101ef65e04c74d217d5  paseo-0.15.0.patch
```

## 构建

需要 Node.js、npm、Git、网络及足够的磁盘空间。以下命令从**插件仓库根目录**运行，使用独立的临时源码目录：

```bash
PASEO_BRIDGE_PATCH="$PWD/host-bridge/paseo-0.15.0.patch"
PASEO_BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/paseo-bridge.XXXXXX")"
git clone https://github.com/getpaseo/paseo.git "$PASEO_BUILD_DIR/source"
git -C "$PASEO_BUILD_DIR/source" checkout --detach 8938fde3c713143f12eacbdd60c11fdfc0be0fb1
git -C "$PASEO_BUILD_DIR/source" apply --check "$PASEO_BRIDGE_PATCH"
git -C "$PASEO_BUILD_DIR/source" apply "$PASEO_BRIDGE_PATCH"
(cd "$PASEO_BUILD_DIR/source" && npm ci --ignore-scripts && npm run postinstall && npm run build:daemon-web-ui)
```

构建完成后，网页产物在 `$PASEO_BUILD_DIR/source/packages/server/dist/server/web-ui`。构建或校验失败时不要继续替换。

## 安装与恢复

先确认 `PASEO_INSTALL_DIR` 指向自己要修改的 Paseo 安装根目录；该目录下面应存在 `node_modules/@getpaseo/server/package.json`。不要把它指向数据目录或源码目录。

```bash
PASEO_INSTALL_DIR="/填写/Paseo/安装目录"
node host-bridge/install.mjs status --install "$PASEO_INSTALL_DIR"
node host-bridge/install.mjs apply --install "$PASEO_INSTALL_DIR" --artifact "$PASEO_BUILD_DIR/source/packages/server/dist/server/web-ui" --confirm
```

脚本检查版本和产物标记，首次替换前把原网页保存为同目录的 `web-ui.original`。已有备份时不会覆盖；如果未打补丁的当前网页与备份不一致，脚本会拒绝替换。更新已打补丁的网页时，也必须有原网页备份。替换后刷新 Paseo 页面。

恢复时保留备份，并刷新页面：

```bash
node host-bridge/install.mjs restore --install "$PASEO_INSTALL_DIR" --confirm
```

Paseo 更新后需要重新核对版本并重新构建；脚本拒绝向其他版本应用此补丁。安装、恢复与升级在各人的实际环境中仍需核对；不要把一个机器上成功当作所有客户端均已验证。
