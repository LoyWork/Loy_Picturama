[English](README.md) | **简体中文**

# Picturama（Loy 分支）

基于 Web 技术构建的本地图片管理软件。

> **分支说明：** 本项目基于 [picturama/picturama](https://github.com/picturama/picturama) 开发，
> 原版应用的功劳归于其作者 Til Schneider 和 Loïc Nogues。本仓库在原版基础上扩展功能，并独立维护发行版本。

## 下载

前往本仓库的 [Releases 页面](https://github.com/LoyWork/Loy_Picturama/releases)，下载最新的 Windows 安装程序。

## 功能预览

### 整理与浏览图片库

以按日期分组的缩略图网格浏览图片，通过侧边栏按文件夹筛选，并快速访问收藏和垃圾桶。

![图片库：按日期排列的缩略图、文件夹导航、收藏与垃圾桶](doc/screenshots/photo-library.png)

### 查看与调整图片

在大图视图中查看图片，结合实时 RGB 直方图调整曝光、对比度、高光、阴影、白平衡、自然饱和度和饱和度。
调色面板还提供颜色混合器（Color Mixer）、色彩分级（Color Grading）和效果（Effects）模块。

![图片详情：大图预览、RGB 直方图与光线和色彩调整面板](doc/screenshots/photo-adjustments.png)

## 功能

保留原版 Picturama 的功能：

- 扫描本地文件：图片保存在本地，无需上传至云服务，保护个人隐私。
- 非破坏性管理：不修改原始图片，清空垃圾桶时除外。
- 支持多种图片格式：JPG、PNG、WebP、HEIC / HEIF，以及 TIF（仅限 macOS）。
- 通过内置的 LightCraft 引擎读取相机 RAW：NEF/NRW、CR2/CR3、ARW、RAF、DNG、RW2、PEF、ORF 和 SRW；对于不支持的变体，尝试使用内嵌预览图。详见 [RAW 支持范围与限制](doc/raw-support.md)。
- 按日期浏览图片。
- 查看大图并缩放。
- 查看 EXIF 信息。
- 标签管理。
- 收藏图片。
- 旋转图片。
- 删除图片。

本分支新增的功能：

- 图片调色：结合 RGB 直方图调整光线和色彩，并提供颜色混合器、色彩分级和效果控件。
- 文件夹侧边栏：浏览图片目录中的顶层文件夹，并按文件夹筛选图片库。
- 统一筛选侧边栏：集中访问所有照片、收藏、垃圾桶、标签和文件夹。
- 图片右键菜单：复制图片到剪贴板、从图片库移除、从磁盘删除（移至系统回收站），以及打开所在文件夹。

## 开发

构建与开发说明请参阅 [DEVELOP.md](DEVELOP.md)。
