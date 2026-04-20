# Obsidian R2 Image Uploader

粘贴图片自动上传到 Cloudflare R2，支持图片管理、重命名、批量替换链接。

## 功能特性

| 功能 | 说明 |
|------|------|
| 粘贴上传 | Ctrl+V 粘贴图片 → 自动上传 → 插入 markdown 链接 |
| 命令上传 | Ctrl+P 搜索「上传图片到 R2」→ 选择文件上传 |
| 图片管理 | 侧边栏 🖼️ 图标 → 查看/复制/重命名/删除 |
| 智能重命名 | 重命名自动搜索笔记中的引用，一键替换旧链接 |
| 复制链接 | 支持复制 markdown 格式链接或纯 URL |

## 安装

### 手动安装

1. 从 [GitHub Releases](https://github.com/Bowie377/obsidian-r2-uploader/releases) 下载最新版本
2. 解压后将以下文件复制到 `<vault>/.obsidian/plugins/obsidian-r2-uploader/`：
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. 打开 Obsidian → 设置 → 第三方插件 → 启用「R2 Image Uploader」

### 从插件市场安装

> 插件正在审核中，审核通过后可在 Obsidian 设置 → 第三方插件 → 浏览 中搜索「R2 Image Uploader」安装。

## 配置

打开 Obsidian 设置 → R2 Image Uploader，填入以下配置：

| 字段 | 说明 | 示例 |
|------|------|------|
| Account ID | Cloudflare 账户 ID | `3792fd7e...` |
| Access Key ID | R2 S3 Access Key（上传用） | `d9c4bc01...` |
| Secret Access Key | R2 S3 Secret Key（上传用） | `f796b8...` |
| Cloudflare API Token | API Token（列表/删除用） | `cfut_...` |
| Bucket | R2 存储桶名称 | `blog` |
| Public URL | 图片公开访问域名 | `https://img.example.com` |
| 路径前缀 | 上传路径前缀 | `images` |

### 获取凭证

#### 1. R2 S3 凭证（上传用）

用于上传图片到 R2 存储桶。

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **R2 Object Storage**
3. 点击 **管理 R2 API 令牌**
4. 点击 **创建 API 令牌**
5. 权限选择：**对象读和写**
6. 选择你的存储桶
7. 点击 **创建 API 令牌**
8. 复制 **Access Key ID** 和 **Secret Access Key**

> ⚠️ Secret Access Key 只显示一次，请立即保存。

#### 2. Cloudflare API Token（列表/删除用）

用于在插件中列出和删除 R2 中的图片。

1. 打开 [Cloudflare API 令牌页面](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **创建令牌**
3. 选择 **创建自定义令牌**
4. 权限设置：
   - **Account** → **Cloudflare R2 Storage** → **Edit**
5. 点击 **继续以显示摘要** → **创建令牌**
6. 复制令牌

#### 3. 公开访问域名

R2 存储桶中的图片需要通过自定义域名公开访问。

1. R2 → 你的存储桶 → **设置**
2. **公开访问** → **连接域**
3. 输入你的域名（如 `img.example.com`）
4. 按照提示配置 DNS

> 如果不配置公开域名，也可以使用 R2.dev 子域名：存储桶 → 设置 → R2.dev 子域名 → 启用

#### 4. CORS 配置

为了允许插件访问 R2 API，需要配置 CORS 策略。

1. R2 → 你的存储桶 → **设置**
2. 找到 **CORS 策略** → **添加**
3. 输入以下内容：

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

4. 点击 **保存**

## 使用方法

### 上传图片

#### 方式一：粘贴上传

1. 复制图片（截图、从网页复制、从文件管理器复制）
2. 在 Obsidian 笔记中按 `Ctrl+V` 粘贴
3. 弹出命名对话框，输入图片名称
4. 点击「上传」或按回车
5. 图片上传成功后自动插入 markdown 链接：`![名称](URL)`

#### 方式二：命令上传

1. 按 `Ctrl+P` 打开命令面板
2. 搜索「上传图片到 R2」
3. 选择要上传的图片文件
4. 输入图片名称
5. 上传成功后自动插入 markdown 链接

### 管理图片

#### 打开管理面板

点击侧边栏的 🖼️ 图标，或按 `Ctrl+P` 搜索「R2 图片管理」。

#### 管理面板功能

| 按钮 | 功能 |
|------|------|
| 📋 | 复制 markdown 链接 `![name](url)` |
| 🔗 | 复制纯图片 URL |
| ✏️ | 重命名图片 |
| 🗑️ | 删除图片 |

#### 重命名图片

1. 点击 ✏️ 按钮
2. 输入新名称（不含扩展名）
3. 确认后，插件会搜索所有笔记中引用该图片的位置
4. 选择：
   - **仅重命名**：只修改 R2 中的文件名，不修改笔记
   - **重命名并替换**：同时修改 R2 中的文件名和所有笔记中的链接

#### 删除图片

1. 点击 🗑️ 按钮
2. 确认删除
3. 图片从 R2 中永久删除

> ⚠️ 删除操作不可恢复。如果笔记中引用了被删除的图片，链接会失效。

## 快捷键设置

为常用操作设置快捷键可以提高效率：

1. 打开 Obsidian 设置 → **快捷键**
2. 搜索以下命令：
   - `上传图片到 R2`
   - `R2 图片管理`
3. 点击右侧的 `+` 按钮
4. 按下你想设置的快捷键组合

**推荐快捷键：**

| 命令 | 推荐快捷键 |
|------|-----------|
| 上传图片到 R2 | `Ctrl+Shift+U` |
| R2 图片管理 | `Ctrl+Shift+I` |

## 自定义 CSS

如果图片在笔记中显示过小，可以添加 CSS 片段调整：

1. 设置 → 外观 → CSS 代码片段 → 打开文件夹
2. 创建 `image-width.css`：

```css
/* 图片自适应页面宽度 */
.markdown-preview-view img {
  max-width: 100%;
  height: auto;
}
```

3. 保存后在 Obsidian 中启用该片段

## 常见问题

### 上传失败：400 错误

**原因**：R2 S3 凭证配置错误。

**解决**：
1. 检查 Account ID 是否正确
2. 检查 Access Key ID 和 Secret Access Key 是否正确
3. 确认 API 令牌有正确的权限

### 上传失败：CORS 错误

**原因**：R2 存储桶未配置 CORS 策略。

**解决**：按照上面的「CORS 配置」步骤配置 CORS 策略。

### 图片显示为 0 字节

**原因**：上传过程中出现问题。

**解决**：
1. 检查控制台（`Ctrl+Shift+I`）的错误信息
2. 确认 R2 存储桶有足够的空间
3. 确认 API 令牌没有过期

### 管理面板不显示图片

**原因**：Cloudflare API Token 配置错误或 CORS 未配置。

**解决**：
1. 检查 Cloudflare API Token 是否正确
2. 确认 API 令牌有 R2 Storage 的读取权限
3. 确认已配置 CORS 策略

### 图片在笔记中显示过小

**原因**：Obsidian 默认以内联方式显示图片。

**解决**：添加 CSS 片段，参考上面的「自定义 CSS」部分。

## License

MIT
