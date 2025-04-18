/**
 * 主题管理器 - 监听网页主题色变更并修改样式
 */

// 存储上一次检测到的color-scheme值
let lastColorScheme = '';
// 存储当前主题状态
let currentThemeIsDark = false;

// 更新所有带有bg-theme类的元素
const updateThemeElements = (isDarkTheme: boolean) => {
  currentThemeIsDark = isDarkTheme; // 存储当前主题状态
  
  // 获取所有bg-theme元素
  const themeElements = document.querySelectorAll('.bg-theme');
  console.log("themeElements数量:", themeElements.length);
  
  // 如果没有找到元素，设置一个延迟再次尝试
  if (themeElements.length === 0) {
    console.log("未找到bg-theme元素，将在稍后重试");
    setTimeout(() => {
      const retryElements = document.querySelectorAll('.bg-theme');
      console.log("重试 - themeElements数量:", retryElements.length);
      applyThemeToElements(retryElements, isDarkTheme);
    }, 500);
    return;
  }
  
  // 应用主题到元素
  applyThemeToElements(themeElements, isDarkTheme);
};

// 将主题应用到元素列表
const applyThemeToElements = (elements: NodeListOf<Element>, isDarkTheme: boolean) => {
  elements.forEach((element) => {
    if (element instanceof HTMLElement) {
      // 设置深色或浅色背景
      element.style.backgroundColor = isDarkTheme ? '#000000' : '#FFFFFF';
      // 如果需要，也可以更新文本颜色
      element.style.color = isDarkTheme ? '#FFFFFF' : '#000000';
    }
  });
  
  if (elements.length > 0) {
    console.log("已成功更新", elements.length, "个元素的主题为:", isDarkTheme ? "深色" : "浅色");
  }
};

// 获取HTML标签的color-scheme值
const getColorScheme = (): string => {
  const htmlElement = document.documentElement;
  const htmlStyle = window.getComputedStyle(htmlElement);
  return htmlStyle.getPropertyValue('color-scheme').trim();
};

// 检查是否为暗色主题
const isDarkTheme = (): boolean => {
  const colorScheme = getColorScheme();
  // 记录当前color-scheme值
  lastColorScheme = colorScheme;
  
  // 打印调试信息
  console.log("当前color-scheme:", colorScheme);
  
  // 判断是否为暗色主题
  return colorScheme === 'dark';
};

// 监听新bg-theme元素的添加
const setupElementObserver = () => {
  // 监听整个文档中新元素的添加
  const bodyObserver = new MutationObserver((mutations) => {
    let newThemeElementsAdded = false;
    
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // 检查是否有新的.bg-theme元素被添加
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('bg-theme')) {
              newThemeElementsAdded = true;
            } else if (node.querySelectorAll) {
              const childThemeElements = node.querySelectorAll('.bg-theme');
              if (childThemeElements.length > 0) {
                newThemeElementsAdded = true;
              }
            }
          }
        });
      }
    });
    
    // 如果检测到新的bg-theme元素，应用当前主题
    if (newThemeElementsAdded) {
      console.log("检测到新的bg-theme元素被添加，应用当前主题");
      const elements = document.querySelectorAll('.bg-theme');
      applyThemeToElements(elements, currentThemeIsDark);
    }
  });
  
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  return bodyObserver;
};

// 监听主题色变更
export const setupThemeObserver = () => {
  // 初始检查并应用主题
  const isDarkMode = isDarkTheme();
  updateThemeElements(isDarkMode);
  
  // 专门监听HTML标签的style属性变化
  const htmlObserver = new MutationObserver((mutations) => {
    // 只关注style属性变化
    const styleChanged = mutations.some(mutation => 
      mutation.attributeName === 'style'
    );
    
    if (styleChanged) {
      // 获取当前color-scheme值
      const currentColorScheme = getColorScheme();
      
      // 只有当color-scheme值变化时才更新主题
      if (currentColorScheme !== lastColorScheme) {
        console.log("color-scheme变化: 从", lastColorScheme, "变为", currentColorScheme);
        const darkMode = currentColorScheme === 'dark';
        updateThemeElements(darkMode);
        lastColorScheme = currentColorScheme;
      }
    }
  });
  
  // 仅监听HTML标签的style属性
  htmlObserver.observe(document.documentElement, { 
    attributes: true,
    attributeFilter: ['style']
  });
  
  // 设置元素观察器以检测新的bg-theme元素
  const elementObserver = setupElementObserver();
  
  // 备用：监听媒体查询变化（用户系统主题变更）
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const mediaHandler = (e: MediaQueryListEvent) => {
    // 只有在没有网站特定主题(color-scheme为空或auto)时才使用系统主题
    const currentColorScheme = getColorScheme();
    if (!currentColorScheme || currentColorScheme === 'auto' || currentColorScheme === 'normal') {
      console.log("系统主题变更:", e.matches ? "深色" : "浅色");
      updateThemeElements(e.matches);
    }
  };
  
  mediaQuery.addEventListener('change', mediaHandler);
  
  // 在DOM内容加载完成后再次检查
  if (document.readyState !== 'complete') {
    window.addEventListener('DOMContentLoaded', () => {
      console.log("DOM内容加载完成，重新检查主题元素");
      updateThemeElements(currentThemeIsDark);
    });
  }
  
  // 页面完全加载后再次检查
  window.addEventListener('load', () => {
    console.log("页面完全加载，重新检查主题元素");
    updateThemeElements(currentThemeIsDark);
  });
  
  // 返回清理函数
  return () => {
    htmlObserver.disconnect();
    elementObserver.disconnect();
    mediaQuery.removeEventListener('change', mediaHandler);
  };
};

// 导出常用主题颜色
export const ThemeColors = {
  DARK: {
    background: '#000000',
    text: '#FFFFFF',
    border: '#444444'
  },
  LIGHT: {
    background: '#FFFFFF',
    text: '#000000',
    border: '#EEEEEE'
  }
}; 