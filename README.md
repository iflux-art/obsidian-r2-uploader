# Obsidian R2 Image Uploader

粘贴图片自动上传到 Cloudflare R2，支持图片管理、重命名、批量替换链接。

## 功能

| 功能 | 说明 |
|------|------|
| 粘贴上传 | Ctrl+V 粘贴图片 → 自动上传 → 插入 markdown 链接 |
| 命令上传 | Ctrl+P → 「上传图片到 R2」→ 选择文件上传 |
| 图片管理 | 侧边栏 🖼️ 图标 → 查看/复制/重命名/删除 |
| 智能重命名 | 重命名自动搜索笔记引用，一键替换旧链接 |
| 批量删除 | 管理面板中切换选择模式，批量删除图片 |

## 安装

### 手动安装

1. 从 [GitHub Releases](https://github.com/iflux-art/obsidian-r2-uploader/releases) 下载最新版本
2. 解压后将以下文件复制到 `<vault>/.obsidian/plugins/obsidian-r2-uploader/`：
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. 打开 Obsidian → 设置 → 第三方插件 → 启用「R2 Image Uploader」

## 配置

打开 Obsidian 设置 → R2 Image Uploader，填入以下配置：

| 设置项 | 说明 | 示例 |
|--------|------|------|
| Account ID | Cloudflare 账户 ID，仪表盘右上角可复制 | `3792fd7e...` |
| Access Key ID | S3 凭证的访问密钥 ID | `b462a44e...` |
| Secret Access Key | S3 凭证的机密访问密钥 | `20a9a389...` |
| 存储桶名称 | R2 存储桶名称 | `images` |
| 自定义域 | 图片公开访问域名 | `https://img.example.com` |
| 上传目录 | 上传路径前缀，留空则传到根目录 | `images` |

### 获取 S3 凭证

插件的所有操作（上传、列表、删除）都通过 S3 兼容 API 完成，只需要一组 S3 凭证。

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **R2 Object Storage** → **管理 R2 API 令牌**
3. 点击 **创建 API 令牌** → 权限选择：**对象读和写**
4. 选择你的存储桶
5. 创建后复制 **Access Key ID** 和 **Secret Access Key**

> ⚠️ Secret Access Key 只显示一次，请立即保存。

### 配置公开访问域名

R2 中的图片需要通过域名公开访问才能在笔记中显示。

**方式一：自定义域名（推荐）**

1. R2 → 你的存储桶 → **设置**
2. **公开访问** → **连接域**
3. 输入你的域名（如 `img.example.com`）
4. 按照提示配置 DNS

**方式二：R2.dev 子域名**

存储桶 → 设置 → R2.dev 子域名 → 启用

### 测试连接

配置完成后，在设置页面点击 **测试** 按钮验证连接是否正常。

## 使用方法

### 上传图片

**粘贴上传：**
1. 复制图片（截图、从网页复制、从文件管理器复制）
2. 在 Obsidian 笔记中按 `Ctrl+V` 粘贴
3. 弹出命名对话框，输入图片名称（默认 `img-时间戳`）
4. 按回车或点击「确认」
5. 自动插入 `![名称](URL)`

**命令上传：**
1. `Ctrl+P` 打开命令面板
2. 搜索「上传图片到 R2」
3. 选择图片文件 → 输入名称 → 自动插入链接

### 管理图片

点击侧边栏 🖼️ 图标，或 `Ctrl+P` → 「R2 图片管理」。

管理面板功能：
- 🔍 搜索：按文件名/路径过滤
- ☑️ 批量选择：切换选择模式，批量删除
- 📋 复制 markdown 链接
- 🔗 复制纯 URL
- ✏️ 重命名（可同步替换笔记中的引用）
- 🗑️ 删除（检测引用笔记，可选清理引用）

### 重命名图片

1. 点击 ✏️ 按钮
2. 输入新名称（不含扩展名）
3. 插件自动搜索所有笔记中引用该图片的位置
4. 选择操作方式：
   - **仅重命名**：只修改 R2 中的文件名
   - **重命名并替换**：同时更新所有笔记中的链接

### 快捷键

在 Obsidian 设置 → 快捷键 中搜索以下命令自定义快捷键：

| 命令 | 推荐快捷键 |
|------|-----------|
| 上传图片到 R2 | `Ctrl+Shift+U` |
| R2 图片管理 | `Ctrl+Shift+I` |

## 常见问题

**上传失败：400 错误**
- 检查 Account ID、Access Key ID、Secret Access Key 是否正确
- 确认 S3 令牌有对象读写权限且选择了正确的存储桶

**管理面板不显示图片**
- 检查 S3 凭证是否正确（管理面板也使用 S3 凭证列出对象）
- 点击设置中的「测试」按钮验证连接

**图片在笔记中显示过小**

添加 CSS 片段调整：

1. 设置 → 外观 → CSS 代码片段 → 打开文件夹
2. 创建 `image-width.css`：

```css
.markdown-preview-view img {
  max-width: 100%;
  height: auto;
}
```

3. 保存后在 Obsidian 中启用该片段

## License

MIT
