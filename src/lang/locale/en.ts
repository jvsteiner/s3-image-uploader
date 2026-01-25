import { LangMap } from "../lang";

export default <LangMap>{
	// Settings page title
	"Settings for S3 Image Uploader": "Settings for S3 Image Uploader",

	// AWS Settings
	"AWS Access Key ID": "AWS Access Key ID",
	"AWS access key ID for a user with S3 access.":
		"AWS access key ID for a user with S3 access.",
	"AWS Secret Key": "AWS Secret Key",
	"AWS secret key for that user.": "AWS secret key for that user.",
	Region: "Region",
	"AWS region of the S3 bucket.": "AWS region of the S3 bucket.",
	"S3 Bucket": "S3 Bucket",
	"S3 bucket name.": "S3 bucket name.",
	"Bucket folder": "Bucket folder",
	"Optional folder in s3 bucket. Support the use of ${year}, ${month}, ${day} and ${basename} variables.":
		"Optional folder in s3 bucket. Support the use of ${year}, ${month}, ${day} and ${basename} variables.",

	// Upload settings
	"Upload on drag": "Upload on drag",
	"Upload drag and drop images as well as pasted images. To override this setting on a per-document basis, you can add `uploadOnDrag: true` to YAML frontmatter of the note.":
		"Upload drag and drop images as well as pasted images. To override this setting on a per-document basis, you can add `uploadOnDrag: true` to YAML frontmatter of the note.",
	"Upload video files": "Upload video files",
	"Upload videos. To override this setting on a per-document basis, you can add `uploadVideo: true` to YAML frontmatter of the note.":
		"Upload videos. To override this setting on a per-document basis, you can add `uploadVideo: true` to YAML frontmatter of the note.",
	"Upload audio files": "Upload audio files",
	"Upload audio files. To override this setting on a per-document basis, you can add `uploadAudio: true` to YAML frontmatter of the note.":
		"Upload audio files. To override this setting on a per-document basis, you can add `uploadAudio: true` to YAML frontmatter of the note.",
	"Upload pdf files": "Upload pdf files",
	"Upload and embed PDF files. To override this setting on a per-document basis, you can add `uploadPdf: true` to YAML frontmatter of the note. Local uploads are not supported for PDF files.":
		"Upload and embed PDF files. To override this setting on a per-document basis, you can add `uploadPdf: true` to YAML frontmatter of the note. Local uploads are not supported for PDF files.",

	// Local upload settings
	"Copy to local folder": "Copy to local folder",
	'Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `localUpload: true` to YAML frontmatter of the note. This will copy the images to a folder in your local file system, instead of s3.':
		'Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `localUpload: true` to YAML frontmatter of the note. This will copy the images to a folder in your local file system, instead of s3.',
	"Local folder": "Local folder",
	'Local folder to save images, instead of s3. To override this setting on a per-document basis, you can add `uploadFolder: "myFolder"` to YAML frontmatter of the note. This affects only local uploads.':
		'Local folder to save images, instead of s3. To override this setting on a per-document basis, you can add `uploadFolder: "myFolder"` to YAML frontmatter of the note. This affects only local uploads.',

	// Custom endpoint settings
	"Use custom endpoint": "Use custom endpoint",
	"Use the custom api endpoint below.": "Use the custom api endpoint below.",
	"Custom S3 Endpoint": "Custom S3 Endpoint",
	"Optionally set a custom endpoint for any S3 compatible storage provider.":
		"Optionally set a custom endpoint for any S3 compatible storage provider.",
	"S3 Path Style URLs": "S3 Path Style URLs",
	"Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com).":
		"Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com).",

	// Custom image URL settings
	"Use custom image URL": "Use custom image URL",
	"Use the custom image URL below.": "Use the custom image URL below.",
	"Custom Image URL": "Custom Image URL",
	"Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN.":
		"Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN.",

	// CORS and query string settings
	"Bypass local CORS check": "Bypass local CORS check",
	"Bypass local CORS preflight checks - it might work on later versions of Obsidian.":
		"Bypass local CORS preflight checks - it might work on later versions of Obsidian.",
	"Query String Key": "Query String Key",
	"Appended to the end of the URL. Optional":
		"Appended to the end of the URL. Optional",
	"Query String Value": "Query String Value",

	// Image compression settings
	"Enable Image Compression": "Enable Image Compression",
	"This will reduce the size of images before uploading.":
		"This will reduce the size of images before uploading.",
	"Max Image Size": "Max Image Size",
	"Maximum size of the image after compression in MB. Default is 1MB.":
		"Maximum size of the image after compression in MB. Default is 1MB.",
	"Image Compression Quality": "Image Compression Quality",
	"Maximum quality of the image after compression. Default is 0.7.":
		"Maximum quality of the image after compression. Default is 0.7.",
	"Max Image Width or Height": "Max Image Width or Height",
	"Maximum width or height of the image after compression. Default is 4096px.":
		"Maximum width or height of the image after compression. Default is 4096px.",

	// Ignore pattern settings
	"Ignore Pattern": "Ignore Pattern",
	"Glob pattern to ignore files/folders. Use * for any characters, ** for any path, ? for single character. Separate multiple patterns with commas. Example: 'private/*, **/drafts/**, temp*'":
		"Glob pattern to ignore files/folders. Use * for any characters, ** for any path, ? for single character. Separate multiple patterns with commas. Example: 'private/*, **/drafts/**, temp*'",

	// Advanced upload settings
	"Advanced Upload Settings": "Advanced Upload Settings",
	"Fallback to local on upload failure": "Fallback to local on upload failure",
	"When S3 upload fails, save the file to local attachment folder instead.":
		"When S3 upload fails, save the file to local attachment folder instead.",
	"Delete local file after upload": "Delete local file after upload",
	"Delete the local file after successfully uploading to S3. Files will be moved to system trash.":
		"Delete the local file after successfully uploading to S3. Files will be moved to system trash.",
	"Enable batch upload log": "Enable batch upload log",
	"Generate a log file after batch upload operations with details about each file.":
		"Generate a log file after batch upload operations with details about each file.",
	"Batch log folder": "Batch log folder",
	"Folder to store batch upload log files.":
		"Folder to store batch upload log files.",

	// Command names
	"Upload image": "Upload image",
	"Batch upload all local images in vault":
		"Batch upload all local images in vault",
	"Batch upload local images in current folder":
		"Batch upload local images in current folder",

	// Context menu items
	"S3: Batch upload images": "S3: Batch upload images",
	"S3: Upload to cloud": "S3: Upload to cloud",
	"S3: Delete local file": "S3: Delete local file",
	"S3: Rename description": "S3: Rename description",
	"S3: Download to local": "S3: Download to local",
	"S3: Delete from cloud": "S3: Delete from cloud",
	"S3: Upload all local images in this file":
		"S3: Upload all local images in this file",

	// Notice messages
	"Uploading files...": "Uploading files...",
	"All files uploaded successfully": "All files uploaded successfully",
	"Error uploading file: ${message}": "Error uploading file: ${message}",
	"No local images found to upload": "No local images found to upload",
	"Scanning for local images...": "Scanning for local images...",
	"Starting batch upload of ${count} files...":
		"Starting batch upload of ${count} files...",
	"Uploading: ${current}/${total}": "Uploading: ${current}/${total}",
	"Batch upload complete: ${success} success, ${failed} failed":
		"Batch upload complete: ${success} success, ${failed} failed",
	"Image compressed from ${originalSize} to ${newSize}":
		"Image compressed from ${originalSize} to ${newSize}",
	"S3 upload failed, saved locally: ${fileName}":
		"S3 upload failed, saved locally: ${fileName}",
	"Uploaded successfully!": "Uploaded successfully!",
	"Upload failed: ${message}": "Upload failed: ${message}",
	"Download failed: ${message}": "Download failed: ${message}",
	"Downloaded to ${path}": "Downloaded to ${path}",
	"Deleted from S3!": "Deleted from S3!",
	"Delete failed: ${message}": "Delete failed: ${message}",
	"No active folder": "No active folder",
	"No active file": "No active file",
	"File not found": "File not found",
	"No local images found in this file": "No local images found in this file",
	"Uploading ${count} images...": "Uploading ${count} images...",
	"Upload complete: ${success} success, ${failed} failed, ${skipped} skipped":
		"Upload complete: ${success} success, ${failed} failed, ${skipped} skipped",
	"Log saved to ${path}": "Log saved to ${path}",
	"Uploading to S3...": "Uploading to S3...",
	"Downloading from S3...": "Downloading from S3...",
	"Deleting from S3...": "Deleting from S3...",
	"Local file deleted!": "Local file deleted!",
	"Description updated!": "Description updated!",
	"Failed to find: ${link}": "Failed to find: ${link}",
	"Error processing file: ${message}": "Error processing file: ${message}",
	"S3 client not configured. Please configure the plugin settings first.":
		"S3 client not configured. Please configure the plugin settings first.",
	"Max Image Compression Size must be a number greater than 0":
		"Max Image Compression Size must be a number greater than 0",
	"Max Image Width or Height must be a number greater than 0":
		"Max Image Width or Height must be a number greater than 0",

	// Modal dialogs
	"Batch Upload Confirmation": "Batch Upload Confirmation",
	"Found ${count} local media files to upload. Continue?":
		"Found ${count} local media files to upload. Continue?",
	"Upload All": "Upload All",
	Cancel: "Cancel",
	"Rename Description": "Rename Description",
	Save: "Save",
	"Delete from S3": "Delete from S3",
	"Are you sure you want to delete this file from S3?":
		"Are you sure you want to delete this file from S3?",
	"This action cannot be undone.": "This action cannot be undone.",
	Delete: "Delete",
};
