import { LangMap } from "../lang";

export default <LangMap>{
	// Settings page title
	"Settings for S3 Image Uploader": "S3 图片上传器设置",

	// AWS Settings
	"AWS Access Key ID": "AWS 访问密钥 ID",
	"AWS access key ID for a user with S3 access.":
		"具有 S3 访问权限的用户的 AWS 访问密钥 ID。",
	"AWS Secret Key": "AWS 密钥",
	"AWS secret key for that user.": "该用户的 AWS 密钥。",
	Region: "区域",
	"AWS region of the S3 bucket.": "S3 存储桶的 AWS 区域。",
	"S3 Bucket": "S3 存储桶",
	"S3 bucket name.": "S3 存储桶名称。",
	"Bucket folder": "存储桶文件夹",
	"Optional folder in s3 bucket. Support the use of ${year}, ${month}, ${day} and ${basename} variables.":
		"S3 存储桶中的可选文件夹。支持使用 ${year}、${month}、${day} 和 ${basename} 变量。",

	// Upload settings
	"Upload on drag": "拖拽时上传",
	"Upload drag and drop images as well as pasted images. To override this setting on a per-document basis, you can add `uploadOnDrag: true` to YAML frontmatter of the note.":
		"上传拖放的图片以及粘贴的图片。如需在单个文档中覆盖此设置，可在笔记的 YAML frontmatter 中添加 `uploadOnDrag: true`。",
	"Upload video files": "上传视频文件",
	"Upload videos. To override this setting on a per-document basis, you can add `uploadVideo: true` to YAML frontmatter of the note.":
		"上传视频。如需在单个文档中覆盖此设置，可在笔记的 YAML frontmatter 中添加 `uploadVideo: true`。",
	"Upload audio files": "上传音频文件",
	"Upload audio files. To override this setting on a per-document basis, you can add `uploadAudio: true` to YAML frontmatter of the note.":
		"上传音频文件。如需在单个文档中覆盖此设置，可在笔记的 YAML frontmatter 中添加 `uploadAudio: true`。",
	"Upload pdf files": "上传 PDF 文件",
	"Upload and embed PDF files. To override this setting on a per-document basis, you can add `uploadPdf: true` to YAML frontmatter of the note. Local uploads are not supported for PDF files.":
		"上传并嵌入 PDF 文件。如需在单个文档中覆盖此设置，可在笔记的 YAML frontmatter 中添加 `uploadPdf: true`。PDF 文件不支持本地上传。",

	// Local upload settings
	"Copy to local folder": "复制到本地文件夹",
	'Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `localUpload: true` to YAML frontmatter of the note. This will copy the images to a folder in your local file system, instead of s3.':
		'将图片复制到本地文件夹而非 S3。如需在单个文档中覆盖此设置，可在笔记的 YAML frontmatter 中添加 `localUpload: true`。这将把图片复制到本地文件系统的文件夹中。',
	"Local folder": "本地文件夹",
	'Local folder to save images, instead of s3. To override this setting on a per-document basis, you can add `uploadFolder: "myFolder"` to YAML frontmatter of the note. This affects only local uploads.':
		'用于保存图片的本地文件夹（替代 S3）。如需在单个文档中覆盖此设置，可在笔记的 YAML frontmatter 中添加 `uploadFolder: "myFolder"`。此设置仅影响本地上传。',

	// Custom endpoint settings
	"Use custom endpoint": "使用自定义端点",
	"Use the custom api endpoint below.": "使用下方的自定义 API 端点。",
	"Custom S3 Endpoint": "自定义 S3 端点",
	"Optionally set a custom endpoint for any S3 compatible storage provider.":
		"可选设置任何 S3 兼容存储提供商的自定义端点。",
	"S3 Path Style URLs": "S3 路径风格 URL",
	"Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com).":
		"高级选项，强制使用（传统）路径风格 S3 URL（s3.myhost.com/bucket）而非现代 AWS 标准的主机风格（bucket.s3.myhost.com）。",

	// Custom image URL settings
	"Use custom image URL": "使用自定义图片 URL",
	"Use the custom image URL below.": "使用下方的自定义图片 URL。",
	"Custom Image URL": "自定义图片 URL",
	"Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN.":
		"高级选项，强制插入自定义图片 URL。如果您使用 CDN，此选项很有帮助。",

	// CORS and query string settings
	"Bypass local CORS check": "绕过本地 CORS 检查",
	"Bypass local CORS preflight checks - it might work on later versions of Obsidian.":
		"绕过本地 CORS 预检检查 - 可能在较新版本的 Obsidian 上有效。",
	"Query String Key": "查询字符串键",
	"Appended to the end of the URL. Optional":
		"附加到 URL 末尾。可选。",
	"Query String Value": "查询字符串值",

	// Image compression settings
	"Enable Image Compression": "启用图片压缩",
	"This will reduce the size of images before uploading.":
		"这将在上传前减小图片大小。",
	"Max Image Size": "最大图片尺寸",
	"Maximum size of the image after compression in MB. Default is 1MB.":
		"压缩后图片的最大尺寸（MB）。默认为 1MB。",
	"Image Compression Quality": "图片压缩质量",
	"Maximum quality of the image after compression. Default is 0.7.":
		"压缩后图片的最大质量。默认为 0.7。",
	"Max Image Width or Height": "最大图片宽度或高度",
	"Maximum width or height of the image after compression. Default is 4096px.":
		"压缩后图片的最大宽度或高度。默认为 4096px。",

	// Ignore pattern settings
	"Ignore Pattern": "忽略模式",
	"Glob pattern to ignore files/folders. Use * for any characters, ** for any path, ? for single character. Separate multiple patterns with commas. Example: 'private/*, **/drafts/**, temp*'":
		"用于忽略文件/文件夹的 Glob 模式。使用 * 匹配任意字符，** 匹配任意路径，? 匹配单个字符。多个模式用逗号分隔。示例：'private/*, **/drafts/**, temp*'",

	// Advanced upload settings
	"Advanced Upload Settings": "高级上传设置",
	"Fallback to local on upload failure": "上传失败时回退到本地",
	"When S3 upload fails, save the file to local attachment folder instead.":
		"当 S3 上传失败时，将文件保存到本地附件文件夹。",
	"Delete local file after upload": "上传后删除本地文件",
	"Delete the local file after successfully uploading to S3. Files will be moved to system trash.":
		"成功上传到 S3 后删除本地文件。文件将被移动到系统回收站。",
	"Enable batch upload log": "启用批量上传日志",
	"Generate a log file after batch upload operations with details about each file.":
		"批量上传操作后生成日志文件，包含每个文件的详细信息。",
	"Batch log folder": "批量日志文件夹",
	"Folder to store batch upload log files.":
		"用于存储批量上传日志文件的文件夹。",

	// Command names
	"Upload image": "上传图片",
	"Batch upload all local images in vault":
		"批量上传仓库中所有本地图片",
	"Batch upload local images in current folder":
		"批量上传当前文件夹中的本地图片",

	// Context menu items
	"S3: Batch upload images": "S3: 批量上传图片",
	"S3: Upload to cloud": "S3: 上传到云端",
	"S3: Delete local file": "S3: 删除本地文件",
	"S3: Rename description": "S3: 重命名描述",
	"S3: Download to local": "S3: 下载到本地",
	"S3: Delete from cloud": "S3: 从云端删除",
	"S3: Upload all local images in this file":
		"S3: 上传此文件中所有本地图片",

	// Notice messages
	"Uploading files...": "正在上传文件...",
	"All files uploaded successfully": "所有文件上传成功",
	"Error uploading file: ${message}": "文件上传错误：${message}",
	"No local images found to upload": "未找到需要上传的本地图片",
	"Scanning for local images...": "正在扫描本地图片...",
	"Starting batch upload of ${count} files...":
		"开始批量上传 ${count} 个文件...",
	"Uploading: ${current}/${total}": "上传中：${current}/${total}",
	"Batch upload complete: ${success} success, ${failed} failed":
		"批量上传完成：${success} 成功，${failed} 失败",
	"Image compressed from ${originalSize} to ${newSize}":
		"图片已从 ${originalSize} 压缩到 ${newSize}",
	"S3 upload failed, saved locally: ${fileName}":
		"S3 上传失败，已保存到本地：${fileName}",
	"Uploaded successfully!": "上传成功！",
	"Upload failed: ${message}": "上传失败：${message}",
	"Download failed: ${message}": "下载失败：${message}",
	"Downloaded to ${path}": "已下载到 ${path}",
	"Deleted from S3!": "已从 S3 删除！",
	"Delete failed: ${message}": "删除失败：${message}",
	"No active folder": "没有活动文件夹",
	"No active file": "没有活动文件",
	"File not found": "文件未找到",
	"No local images found in this file": "此文件中未找到本地图片",
	"Uploading ${count} images...": "正在上传 ${count} 张图片...",
	"Upload complete: ${success} success, ${failed} failed, ${skipped} skipped":
		"上传完成：${success} 成功，${failed} 失败，${skipped} 跳过",
	"Log saved to ${path}": "日志已保存到 ${path}",
	"Uploading to S3...": "正在上传到 S3...",
	"Downloading from S3...": "正在从 S3 下载...",
	"Deleting from S3...": "正在从 S3 删除...",
	"Local file deleted!": "本地文件已删除！",
	"Description updated!": "描述已更新！",
	"Failed to find: ${link}": "未能找到：${link}",
	"Error processing file: ${message}": "处理文件时出错：${message}",
	"S3 client not configured. Please configure the plugin settings first.":
		"S3 客户端未配置。请先配置插件设置。",
	"Max Image Compression Size must be a number greater than 0":
		"最大图片压缩尺寸必须是大于 0 的数字",
	"Max Image Width or Height must be a number greater than 0":
		"最大图片宽度或高度必须是大于 0 的数字",

	// Modal dialogs
	"Batch Upload Confirmation": "批量上传确认",
	"Found ${count} local media files to upload. Continue?":
		"发现 ${count} 个本地媒体文件需要上传。是否继续？",
	"Upload All": "全部上传",
	Cancel: "取消",
	"Rename Description": "重命名描述",
	Save: "保存",
	"Delete from S3": "从 S3 删除",
	"Are you sure you want to delete this file from S3?":
		"确定要从 S3 删除此文件吗？",
	"This action cannot be undone.": "此操作无法撤销。",
	Delete: "删除",
};
