// Add debugging flag
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[Indeed Insights]', ...args);
}

// Track current job ID to detect changes
let currentJobId = null;
let isRefreshing = false;

// Function to extract job ID from URL
function extractJobIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const vjk = urlParams.get('vjk');
  const jk = urlParams.get('jk');
  
  // Also check the pathname for job ID
  const pathMatch = window.location.pathname.match(/\/viewjob\?.*jk=([^&]+)/);
  const pathJobId = pathMatch ? pathMatch[1] : null;
  
  const jobId = vjk || jk || pathJobId;
  log('Extracted job ID:', jobId, 'from URL:', window.location.href);
  return jobId;
}

// Function to check if we need to refresh for new job data
function shouldRefreshForNewJob() {
  const newJobId = extractJobIdFromUrl();
  
  if (!newJobId) {
    log('No job ID found in URL');
    return false;
  }
  
  if (currentJobId && currentJobId !== newJobId && !isRefreshing) {
    log('Job ID changed from', currentJobId, 'to', newJobId, '- refresh needed');
    return true;
  }
  
  currentJobId = newJobId;
  return false;
}

// Function to refresh page with current URL
function refreshForNewJobData() {
  if (isRefreshing) return;
  
  isRefreshing = true;
  log('Refreshing page for new job data...');
  
  // Store a flag to prevent infinite refresh loops
  sessionStorage.setItem('indeed-insights-refreshed', Date.now().toString());
  
  // Refresh the page
  window.location.reload();
}

// Function to extract JSON more carefully
function extractJSONFromScript(scriptContent) {
  // Find the start of window._initialData
  const startPattern = 'window._initialData';
  const startIndex = scriptContent.indexOf(startPattern);
  
  if (startIndex === -1) return null;
  
  // Find the equals sign
  let equalsIndex = scriptContent.indexOf('=', startIndex);
  if (equalsIndex === -1) return null;
  
  // Skip whitespace after equals
  let jsonStart = equalsIndex + 1;
  while (jsonStart < scriptContent.length && /\s/.test(scriptContent[jsonStart])) {
    jsonStart++;
  }
  
  // Now we need to find the matching closing brace
  if (scriptContent[jsonStart] !== '{') return null;
  
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let jsonEnd = jsonStart;
  
  for (let i = jsonStart; i < scriptContent.length; i++) {
    const char = scriptContent[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !inString) {
      inString = true;
    } else if (char === '"' && inString) {
      inString = false;
    }
    
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }
  
  if (braceCount !== 0) {
    log('Unmatched braces in JSON');
    return null;
  }
  
  const jsonString = scriptContent.substring(jsonStart, jsonEnd);
  
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    log('Failed to parse extracted JSON:', e.message);
    // Try to clean up common issues
    try {
      // Remove trailing semicolon if present
      const cleanedJson = jsonString.replace(/;$/, '');
      return JSON.parse(cleanedJson);
    } catch (e2) {
      log('Failed to parse cleaned JSON:', e2.message);
      return null;
    }
  }
}

// Function to extract job data from window._initialData
function extractJobData() {
  log('Starting job data extraction...');
  
  // Method 1: Try to access window._initialData directly
  if (window._initialData) {
    log('Found window._initialData directly');
    return parseJobData(window._initialData);
  }
  
  // Method 2: Search in script tags with better extraction
  const scripts = document.getElementsByTagName('script');
  log(`Found ${scripts.length} script tags`);
  
  for (let i = 0; i < scripts.length; i++) {
    const content = scripts[i].textContent || scripts[i].innerText || '';
    
    if (content.includes('window._initialData')) {
      log(`Found window._initialData in script tag ${i}`);
      
      const extractedData = extractJSONFromScript(content);
      if (extractedData) {
        log('Successfully extracted and parsed data');
        return parseJobData(extractedData);
      }
    }
  }
  
  // Method 3: Try to evaluate in isolated context
  try {
    const scripts = Array.from(document.scripts);
    for (let script of scripts) {
      if (script.textContent && script.textContent.includes('window._initialData')) {
        // Create a temporary function to extract the data
        const extractFunction = new Function(`
          var window = {};
          ${script.textContent}
          return window._initialData;
        `);
        
        try {
          const data = extractFunction();
          if (data) {
            log('Extracted data using Function constructor');
            return parseJobData(data);
          }
        } catch (e) {
          log('Failed to execute extraction function:', e.message);
        }
      }
    }
  } catch (e) {
    log('Failed to use Function constructor method:', e.message);
  }
  
  log('No job data found');
  return null;
}

function parseJobData(initialData) {
  log('Parsing job data structure...');
  
  try {
    // Log the structure to understand it better
    log('Initial data keys:', Object.keys(initialData).slice(0, 10)); // Only log first 10 keys
    
    // Try different paths that Indeed might use
    let jobData = null;
    let hireInsights = null;
    
    // Check for the job response in various locations
    const responseKeys = Object.keys(initialData).filter(key => 
      key.toLowerCase().includes('job') || 
      key.toLowerCase().includes('response')
    );
    
    log('Found potential job-related keys:', responseKeys);
    
    // Try the original path first
    if (initialData.autoOpenTwoPaneViewjobResponse) {
      const response = initialData.autoOpenTwoPaneViewjobResponse;
      jobData = response.body?.hostQueryExecutionResult?.data?.jobData?.results?.[0]?.job;
      hireInsights = response.body?.hiringInsightsModel;
      
      if (jobData) {
        log('Found job data in autoOpenTwoPaneViewjobResponse');
      }
    }
    
    // Try other potential paths
    if (!jobData) {
      for (let key of responseKeys) {
        const value = initialData[key];
        if (value && typeof value === 'object') {
          // Look for job data in this object
          const potentialJob = findJobData(value);
          if (potentialJob) {
            jobData = potentialJob.job;
            hireInsights = potentialJob.insights;
            log(`Found job data in ${key}`);
            break;
          }
        }
      }
    }
    
    if (!jobData) {
      log('Could not find job data in any known path');
      return null;
    }
    
    log('Job data found, extracting fields...');
    
    const hireDemand = jobData.hiringDemand || {};
    
    // Extract data with safe defaults
    const extractedData = {
      isRepost: jobData.isRepost || false,
      isLatestPost: jobData.isLatestPost || false,
      datePublished: jobData.datePublished ? new Date(parseInt(jobData.datePublished)) : null,
      employerLastReviewed: hireInsights?.employerLastReviewed || null,
      numOfCandidates: hireInsights?.numOfCandidates || 'N/A',
      urgent: hireDemand.isUrgentHire || false,
      highVolumeHire: hireDemand.isHighVolumeHiring || false
    };
    
    log('Extracted data:', extractedData);
    return extractedData;
    
  } catch (e) {
    log('Error parsing job data:', e);
    return null;
  }
}

// Helper function to recursively find job data
function findJobData(obj, depth = 0) {
  if (depth > 5) return null; // Prevent infinite recursion
  
  if (obj && typeof obj === 'object') {
    // Check if this object has job data
    if (obj.job && (obj.job.datePublished || obj.job.isRepost !== undefined)) {
      return { job: obj.job, insights: null };
    }
    
    // Check for results array
    if (obj.results && Array.isArray(obj.results) && obj.results[0]?.job) {
      return { job: obj.results[0].job, insights: null };
    }
    
    // Recursively search
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        const result = findJobData(obj[key], depth + 1);
        if (result) {
          // Also check for hiring insights at this level
          if (obj.hiringInsightsModel) {
            result.insights = obj.hiringInsightsModel;
          }
          return result;
        }
      }
    }
  }
  
  return null;
}

// Function to create and display the insights panel
function displayInsights(data) {
  log('Displaying insights panel...');
  
  // Remove existing panel if any
  const existingPanel = document.getElementById('indeed-insights-panel');
  if (existingPanel) {
    existingPanel.remove();
  }
  
  // Create the panel
  const panel = document.createElement('div');
  panel.id = 'indeed-insights-panel';
  
  // Format date
  const dateStr = data.datePublished 
    ? data.datePublished.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : 'Not available';
  
  // Create HTML content
  panel.innerHTML = `
    <div class="insights-header">
      <h3>Job Insights</h3>
      <button class="close-btn">&times;</button>
    </div>
    <div class="insights-content">
      <div class="insight-item">
        <span class="label">Is Repost:</span>
        <span class="value ${data.isRepost ? 'warning' : 'good'}">${data.isRepost ? 'Yes' : 'No'}</span>
      </div>
      <div class="insight-item">
        <span class="label">Latest Post:</span>
        <span class="value">${data.isLatestPost ? 'Yes' : 'No'}</span>
      </div>
      <div class="insight-item">
        <span class="label">Date Published:</span>
        <span class="value">${dateStr}</span>
      </div>
      <div class="insight-item">
        <span class="label">Employer Last Reviewed:</span>
        <span class="value">${data.employerLastReviewed || 'Not available'}</span>
      </div>
      <div class="insight-item">
        <span class="label">Number of Candidates:</span>
        <span class="value info-blue">${data.numOfCandidates}</span>
      </div>
      <div class="insight-item">
        <span class="label">Urgent Hire:</span>
        <span class="value ${data.urgent ? 'warning' : ''}">${data.urgent ? 'Yes' : 'No'}</span>
      </div>
      <div class="insight-item">
        <span class="label">High Volume Hiring:</span>
        <span class="value ${data.highVolumeHire ? 'good' : ''}">${data.highVolumeHire ? 'Yes' : 'No'}</span>
      </div>
    </div>
  `;
  
  // Add close button functionality
  panel.querySelector('.close-btn').addEventListener('click', () => {
    panel.remove();
  });
  
  // Add to page
  document.body.appendChild(panel);
  log('Panel added to page');
}

// Function to check if we're on a job detail page
function isJobDetailPage() {
  const isDetailPage = window.location.pathname.includes('/viewjob') || 
         window.location.search.includes('vjk=') ||
         window.location.search.includes('jk=') ||
         document.querySelector('[data-testid="job-details"]') !== null ||
         document.querySelector('.jobsearch-JobComponent') !== null ||
         document.querySelector('[id*="jobDetails"]') !== null;
  
  log('Is job detail page:', isDetailPage, 'URL:', window.location.href);
  return isDetailPage;
}

// Function to wait for element
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// Main function to run the extraction
async function runExtraction() {
  log('Running extraction...');
  
  if (!isJobDetailPage()) {
    log('Not on a job detail page');
    return;
  }
  
  // Check if we should refresh for new job data
  if (shouldRefreshForNewJob()) {
    refreshForNewJobData();
    return;
  }
  
  // Wait a bit for data to load
  log('Waiting for page to fully load...');
  await waitForElement('.jobsearch-JobComponent, [data-testid="job-details"], [id*="jobDetails"]', 3000);
  
  // Try extraction multiple times with delays
  let attempts = 0;
  const maxAttempts = 3;
  
  const tryExtraction = () => {
    attempts++;
    log(`Extraction attempt ${attempts}/${maxAttempts}`);
    
    const data = extractJobData();
    if (data) {
      displayInsights(data);
      isRefreshing = false; // Reset refresh flag on successful extraction
    } else if (attempts < maxAttempts) {
      setTimeout(tryExtraction, 1500);
    } else {
      log('Could not extract job data after', maxAttempts, 'attempts');
      // Show error panel
      showErrorPanel();
      isRefreshing = false; // Reset refresh flag
    }
  };
  
  tryExtraction();
}

function showErrorPanel() {
  const panel = document.createElement('div');
  panel.id = 'indeed-insights-panel';
  panel.innerHTML = `
    <div class="insights-header">
      <h3>Job Insights</h3>
      <button class="close-btn">&times;</button>
    </div>
    <div class="insights-content">
      <p style="color: #666; text-align: center; padding: 20px;">
        Unable to extract job data from this page. 
        <br><br>
        Try refreshing the page or selecting a different job.
        <br><br>
        <button id="manual-refresh" style="background: #2557a7; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
          Refresh Page
        </button>
      </p>
    </div>
  `;
  
  panel.querySelector('.close-btn').addEventListener('click', () => {
    panel.remove();
  });
  
  panel.querySelector('#manual-refresh').addEventListener('click', () => {
    window.location.reload();
  });
  
  document.body.appendChild(panel);
}

// Check if this is a fresh load after refresh
function checkIfJustRefreshed() {
  const refreshTime = sessionStorage.getItem('indeed-insights-refreshed');
  if (refreshTime) {
    const timeSinceRefresh = Date.now() - parseInt(refreshTime);
    // If less than 3 seconds ago, consider it a fresh refresh
    if (timeSinceRefresh < 3000) {
      log('Page was just refreshed for new job data');
      sessionStorage.removeItem('indeed-insights-refreshed');
      isRefreshing = false;
      return true;
    }
  }
  return false;
}

// Enhanced URL change detection
let lastUrl = location.href;
let urlChangeTimeout = null;

function handleUrlChange() {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    log('URL changed to:', url);
    
    // Clear any existing timeout
    if (urlChangeTimeout) {
      clearTimeout(urlChangeTimeout);
    }
    
    // Set a timeout to run extraction after URL stabilizes
    urlChangeTimeout = setTimeout(() => {
      if (isJobDetailPage()) {
        runExtraction();
      }
    }, 500);
  }
}

// Run when page loads
log('Extension loaded, waiting for DOM...');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    log('DOM loaded');
    checkIfJustRefreshed();
    currentJobId = extractJobIdFromUrl();
    setTimeout(runExtraction, 1000);
  });
} else {
  log('DOM already loaded');
  checkIfJustRefreshed();
  currentJobId = extractJobIdFromUrl();
  setTimeout(runExtraction, 1000);
}

// Listen for URL changes (for single-page navigation)
new MutationObserver(handleUrlChange).observe(document, {
  subtree: true, 
  childList: true
});

// Also listen for popstate events (back/forward button)
window.addEventListener('popstate', handleUrlChange);

// Listen for manual refresh command (useful for debugging)
document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+I to manually trigger extraction
  if (e.ctrlKey && e.shiftKey && e.key === 'I') {
    log('Manual extraction triggered');
    runExtraction();
  }
  
  // Ctrl+Shift+R to force refresh
  if (e.ctrlKey && e.shiftKey && e.key === 'R') {
    log('Manual refresh triggered');
    isRefreshing = false; // Reset flag
    sessionStorage.removeItem('indeed-insights-refreshed');
    window.location.reload();
  }
});
