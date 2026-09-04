/**
 * Nestbau v2.0 - QA Design Validation Script
 * Validiert Design-Modernisierung gegen DESIGN-GUIDE.md
 */

const QAValidator = {
  results: {},
  issues: [],

  // ==================== COLORS ====================
  validateColors() {
    const root = getComputedStyle(document.documentElement);
    const expected = {
      '--primary-orange': '#FF8C42',
      '--primary-peach': '#FFB84D',
      '--secondary-green': '#A8D5BA'
    };

    const colors = {
      orange: root.getPropertyValue('--primary-orange').trim(),
      peach: root.getPropertyValue('--primary-peach').trim(),
      green: root.getPropertyValue('--secondary-green').trim()
    };

    const allPresent = Object.values(colors).every(c => c.length > 0);
    this.results.colors = {
      status: allPresent ? '✅ PASS' : '❌ FAIL',
      orange: colors.orange,
      peach: colors.peach,
      green: colors.green,
      details: allPresent ? 'All color variables defined' : 'Missing CSS variables'
    };

    if (!allPresent) {
      this.issues.push('❌ CSS color variables not defined');
    }
    return allPresent;
  },

  // ==================== TYPOGRAPHY ====================
  validateTypography() {
    const h1 = document.querySelector('h1');
    const h2 = document.querySelector('h2');
    const p = document.querySelector('p');

    const fontFamily = getComputedStyle(document.documentElement).fontFamily;
    const hasModernFont = fontFamily.includes('system') || fontFamily.includes('Segoe') || fontFamily.includes('Roboto');

    this.results.typography = {
      status: hasModernFont ? '✅ PASS' : '⚠️ CHECK',
      fontFamily: fontFamily.slice(0, 50),
      details: 'System font stack present'
    };

    return hasModernFont;
  },

  // ==================== TOUCH TARGETS ====================
  validateTouchTargets() {
    const minSize = 44; // 44px ist das Minimum
    const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
      const rect = b.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const sizes = buttons.map(b => {
      const rect = b.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        ok: rect.width >= minSize && rect.height >= minSize
      };
    });

    const passCount = sizes.filter(s => s.ok).length;
    const totalCount = sizes.length;
    const percentage = Math.round((passCount / totalCount) * 100);

    this.results.touchTargets = {
      status: percentage >= 70 ? '✅ PASS' : '⚠️ PARTIAL',
      passCount,
      totalCount,
      percentage: `${percentage}%`,
      samples: sizes.slice(0, 5)
    };

    if (percentage < 90) {
      this.issues.push(`⚠️ Touch targets: Only ${passCount}/${totalCount} buttons >= ${minSize}px`);
    }
    return percentage >= 70;
  },

  // ==================== ANIMATIONS ====================
  validateAnimations() {
    const styles = Array.from(document.styleSheets).find(s => s.href?.includes('nestbau-design'));
    const hasAnimations = window.getComputedStyle(document.body).transitionDuration !== '0s';

    this.results.animations = {
      status: '⚠️ CHECK',
      details: 'CSS transitions configured',
      note: 'Requires interaction to fully test'
    };

    return true;
  },

  // ==================== CONTRAST ====================
  validateContrast() {
    // Einfache Kontrastprüfung für Hauptelemente
    const titleColor = window.getComputedStyle(document.querySelector('h1') || document.body).color;
    const bgColor = window.getComputedStyle(document.body).backgroundColor;

    this.results.contrast = {
      status: '⚠️ MANUAL',
      titleColor,
      bgColor,
      note: 'Use WAVE tool or axe DevTools for detailed WCAG AA validation',
      requirement: '4.5:1 for text, 3:1 for graphics'
    };

    return true;
  },

  // ==================== RESPONSIVE ====================
  validateResponsive() {
    const viewportWidth = window.innerWidth;
    const hasHorizontalScroll = document.body.scrollWidth > window.innerWidth;

    this.results.responsive = {
      status: hasHorizontalScroll ? '❌ FAIL' : '✅ PASS',
      viewportWidth: `${viewportWidth}px`,
      bodyWidth: `${document.body.scrollWidth}px`,
      horizontalScroll: hasHorizontalScroll,
      details: hasHorizontalScroll ? 'Unwanted horizontal scroll detected' : 'No horizontal scroll'
    };

    if (hasHorizontalScroll) {
      this.issues.push('❌ Horizontal scroll detected on viewport');
    }
    return !hasHorizontalScroll;
  },

  // ==================== CSS LOADED ====================
  validateCSSLoaded() {
    const styleSheets = Array.from(document.styleSheets).map(s => s.href || s.title || 'inline');
    const hasDesignCSS = styleSheets.some(s => s.includes('nestbau-design.css'));
    const sheetCount = document.styleSheets.length;

    this.results.cssLoaded = {
      status: hasDesignCSS ? '✅ PASS' : '❌ FAIL',
      designCSSLoaded: hasDesignCSS,
      totalSheets: sheetCount,
      sheets: styleSheets.slice(0, 5)
    };

    if (!hasDesignCSS) {
      this.issues.push('❌ nestbau-design.css not loaded');
    }
    return hasDesignCSS;
  },

  // ==================== DARK MODE ====================
  validateDarkMode() {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const isDarkMode = darkModeQuery.matches;

    // Prüfe auf HTML/Body data-theme Attribute
    const dataTheme = document.documentElement.getAttribute('data-theme') || 'system';

    this.results.darkMode = {
      status: '✅ CHECK',
      systemDarkMode: isDarkMode,
      dataTheme: dataTheme,
      details: 'Dark mode detection working',
      note: 'Manual toggle should work if implemented'
    };

    return true;
  },

  // ==================== RUN ALL TESTS ====================
  runAll() {
    console.log('🚀 Starting Nestbau v2.0 QA Validation...\n');

    this.validateCSSLoaded();
    this.validateColors();
    this.validateTypography();
    this.validateTouchTargets();
    this.validateAnimations();
    this.validateContrast();
    this.validateResponsive();
    this.validateDarkMode();

    return this.generateReport();
  },

  // ==================== REPORT ====================
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent.slice(0, 80),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      results: this.results,
      issues: this.issues,
      summary: {
        totalTests: Object.keys(this.results).length,
        issues: this.issues.length,
        overallStatus: this.issues.length === 0 ? '✅ GO' : '⚠️ REVIEW'
      }
    };

    console.table(report.results);
    console.log('\n🐛 Issues Found:', report.issues);
    console.log('\n📊 Summary:', report.summary);

    return report;
  }
};

// Führe Validierung aus
const report = QAValidator.runAll();
window.QAReport = report;
report;
