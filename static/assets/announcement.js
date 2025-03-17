// 公告系统 - 纯JS实现
const announcementUrl = '__INJECT_ANNOUNCEMENT_URL__';

(function () {
    if (!announcementUrl) {
        return;
    }

    // 创建并注入CSS样式
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
      .announcement-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      .announcement-modal {
        background-color: #343541;
        color: #ECECF1;
        border-radius: 8px;
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        display: flex;
        flex-direction: column;
      }
      
      .announcement-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background-color: #444654;
        border-bottom: 1px solid #565869;
      }
      
      .announcement-title {
        font-weight: 600;
        font-size: 16px;
        margin: 0;
      }
      
      .announcement-content {
        padding: 24px;
        overflow-y: auto;
      }
      
      .announcement-close {
        background-color: transparent;
        border: none;
        color: #ECECF1;
        font-size: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 4px;
      }
      
      .announcement-close:hover {
        background-color: rgba(255, 255, 255, 0.1);
      }
      
      .announcement-button {
        position: fixed;
        bottom: 20px;
        width: 100px;
        left: 20px;
        background-color: #343541;
        color: #ECECF1;
        border: 1px solid #565869;
        border-radius: 4px;
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.2s ease;
        z-index: 999;
      }
      
      .announcement-button:hover {
        background-color: #444654;
      }
      
      .announcement-fade-in {
        opacity: 1;
      }

      @keyframes announcement-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
      }
      
      .announcement-new {
        animation: announcement-pulse 2s infinite;
      }

      /* 超链接样式 */
      .announcement-content a {
        color: #7ab7ff;
        text-decoration: none;
        padding-bottom: 1px;
      }
      
      .announcement-content a:hover {
        color: #5e83b3;
      }
      
      .announcement-content a:active {
        opacity: 0.8;
      }
    `;
        document.head.appendChild(style);
    }

    // 获取公告内容
    async function fetchAnnouncement() {
        try {
            const response = await fetch(announcementUrl);
            if (!response.ok) {
                throw new Error('Failed to fetch announcement');
            }
            return await response.text();
        } catch (error) {
            console.error('Error fetching announcement:', error);
            return null;
        }
    }

    // 检查是否已读
    function isAnnouncementRead(content) {
        const readAnnouncements = JSON.parse(localStorage.getItem('readAnnouncements') || '{}');
        // 使用内容的哈希作为键
        const contentHash = hashContent(content);
        return readAnnouncements[contentHash];
    }

    // 简单的哈希函数，用于生成内容的唯一标识符
    function hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return hash.toString(16);
    }

    // 标记公告为已读
    function markAnnouncementAsRead(content) {
        const readAnnouncements = JSON.parse(localStorage.getItem('readAnnouncements') || '{}');
        const contentHash = hashContent(content);
        readAnnouncements[contentHash] = true;
        localStorage.setItem('readAnnouncements', JSON.stringify(readAnnouncements));
    }

    // 创建公告模态框
    function createAnnouncementModal(content) {
        const overlay = document.createElement('div');
        overlay.className = 'announcement-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'announcement-modal';

        // 创建标题栏
        const header = document.createElement('div');
        header.className = 'announcement-header';

        const title = document.createElement('h3');
        title.className = 'announcement-title';
        title.textContent = '公告';

        const closeButton = document.createElement('button');
        closeButton.className = 'announcement-close';
        closeButton.innerHTML = '&times;';
        closeButton.setAttribute('aria-label', '关闭公告');
        closeButton.onclick = function () {
            closeModal(overlay, content);
        };

        header.appendChild(title);
        header.appendChild(closeButton);

        // 创建内容区域
        const contentDiv = document.createElement('div');
        contentDiv.className = 'announcement-content';
        contentDiv.innerHTML = content;

        modal.appendChild(header);
        modal.appendChild(contentDiv);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // 使用setTimeout来触发过渡效果
        setTimeout(() => overlay.classList.add('announcement-fade-in'), 10);

        return overlay;
    }

    // 关闭模态框
    function closeModal(overlay, content) {
        overlay.classList.remove('announcement-fade-in');

        // 等待过渡效果完成后移除元素
        setTimeout(() => {
            document.body.removeChild(overlay);
            markAnnouncementAsRead(content);
            createAnnouncementButton(content);
        }, 300);
    }

    // 创建右下角的公告按钮
    function createAnnouncementButton(content) {
        // 检查是否已经存在按钮
        let button = document.querySelector('.announcement-button');

        if (!button) {
            button = document.createElement('button');
            button.className = 'announcement-button';
            button.textContent = '公告';
            document.body.appendChild(button);
        }

        // 移除可能存在的新公告动画效果
        button.classList.remove('announcement-new');

        button.onclick = function () {
            // 移除现有的模态框（如果有）
            const existingOverlay = document.querySelector('.announcement-modal-overlay');
            if (existingOverlay) {
                document.body.removeChild(existingOverlay);
            }

            // 创建并显示新的模态框
            createAnnouncementModal(content);
        };
    }

    // 主函数：初始化公告系统
    async function initAnnouncementSystem() {
        setTimeout(async () => {
            // 注入样式
            injectStyles();

            // 获取公告内容
            const content = await fetchAnnouncement();

            // 如果获取失败或内容为空，退出
            if (!content) return;

            // 检查公告是否已读
            if (!isAnnouncementRead(content)) {
                // 未读，显示模态框
                createAnnouncementModal(content);
            } else {
                // 已读，创建公告按钮
                createAnnouncementButton(content);
            }
        }, 10000);
    }

    // 页面加载完成后执行初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAnnouncementSystem);
    } else {
        initAnnouncementSystem();
    }

    // 每隔一段时间检查公告是否有更新
    setInterval(async function () {
        const content = await fetchAnnouncement();
        if (!content) return;

        if (!isAnnouncementRead(content)) {
            // 如果有未读的新公告，给按钮添加动画效果
            const button = document.querySelector('.announcement-button');
            if (button) {
                button.classList.add('announcement-new');
            } else {
                // 如果按钮不存在，说明用户可能还没看过任何公告，显示模态框
                createAnnouncementModal(content);
            }
        }
    }, 3600000); // 每小时检查一次
})();