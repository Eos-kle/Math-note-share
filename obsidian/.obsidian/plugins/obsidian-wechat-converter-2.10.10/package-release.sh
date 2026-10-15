#!/bin/bash

# 定义插件名称
PLUGIN_NAME="obsidian-wechat-converter"
ZIP_FILE="${PLUGIN_NAME}.zip"

echo "📦 开始打包 $PLUGIN_NAME..."

# 删除旧的 zip 文件
if [ -f "$ZIP_FILE" ]; then
    rm "$ZIP_FILE"
fi

# 打包必要文件（三件套 + 文档）
zip -r "$ZIP_FILE" \
    main.js \
    manifest.json \
    styles.css \
    -x "*.DS_Store*"

echo "✅ 打包完成: $ZIP_FILE"
echo "👉 官方 GitHub Release 仅上传 main.js / manifest.json / styles.css；zip 仅作为本地手动安装包。"
