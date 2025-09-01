// Add debugging flag
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[Indeed Insights]', ...args);
}

// Track current job ID to detect changes
let currentJobId = null;
let isProcessingJobChange = false;
let suppressPanelDisplay = false;

// Function to extract job ID from URL
function extractJobIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const vjk = urlParams.get('vjk');
  const jk = urlParams.get('jk');
  
  // Also check the pathname for job ID
  const pathMatch = window.location.pathname.match(/\/viewjob\?.*[jv]k=([^&]+)/);
  const pathJobId = pathMatch ? pathMatch[1] : null;
  
  const jobId = vjk || jk || pathJobId;
  log('Extracted job ID:', jobId, 'from URL:', window.location.href);
  return jobId;
}

// Function to show loading state
function showLoadingState() {
  const existingPanel = document.getElementById('indeed-insights-panel');
  if (existingPanel) {
    const content = existingPanel.querySelector('.insights-content');
    if (content) {
      content.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #666;">
          <div style="display: inline-block; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2557a7; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 10px;"></div>
          <br>
          Loading job insights...
        </div>
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `;
    }
  }
}

// Function to perform a fast, targeted refresh
function fastRefreshForNewJob() {
  if (isProcessingJobChange) return;
  
  isProcessingJobChange = true;
  suppressPanelDisplay = true; // Prevent panel from showing during refresh
  log('Performing fast refresh for new job data...');
  
  // Remove existing panel immediately to prevent double display
  const existingPanel = document.getElementById('indeed-insights-panel');
  if (existingPanel) {
    existingPanel.remove();
  }
  
  // Use replace() instead of reload() to avoid adding to browser history
  const currentUrl = window.location.href;
  const separator = currentUrl.includes('?') ? '&' : '?';
  const refreshUrl = currentUrl + separator + '_r=' + Date.now();
  
  window.location.replace(refreshUrl);
}

// Function to extract JSON from script tags
function extractJSONFromScript(scriptContent) {
  const startPattern = 'window._initialData';
  const startIndex = scriptContent.indexOf(startPattern);
  
  if (startIndex === -1) return null;
  
  let equalsIndex = scriptContent.indexOf('=', startIndex);
  if (equalsIndex === -1) return null;
  
  let jsonStart = equalsIndex + 1;
  while (jsonStart < scriptContent.length && /\s/.test(scriptContent[jsonStart])) {
    jsonStart++;
  }
  
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
  
  if (braceCount !== 0) return null;
  
  const jsonString = scriptContent.substring(jsonStart, jsonEnd);
  
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    try {
      const cleanedJson = jsonString.replace(/;$/, '');
      return JSON.parse(cleanedJson);
    } catch (e2) {
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
  
  // Method 2: Search in script tags
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
  
  log('No job data found');
  return null;
}

function parseJobData(initialData) {
  log('Parsing job data structure...');
  
  try {
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
  if (depth > 5) return null;
  
  if (obj && typeof obj === 'object') {
    if (obj.job && (obj.job.datePublished || obj.job.isRepost !== undefined)) {
      return { job: obj.job, insights: null };
    }
    
    if (obj.results && Array.isArray(obj.results) && obj.results[0]?.job) {
      return { job: obj.results[0].job, insights: null };
    }
    
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        const result = findJobData(obj[key], depth + 1);
        if (result) {
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
  // Don't display panel if we're in the middle of processing a job change
  if (suppressPanelDisplay) {
    log('Suppressing panel display during refresh process');
    return;
  }
  
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
  
  panel.querySelector('.close-btn').addEventListener('click', () => {
    panel.remove();
  });
  
  document.body.appendChild(panel);
  log('Panel added to page');
  
  // Reset processing flags
  isProcessingJobChange = false;
  suppressPanelDisplay = false;
}

// Function to check if we're on a job detail page
function isJobDetailPage() {
  return window.location.pathname.includes('/viewjob') || 
         window.location.search.includes('vjk=') ||
         window.location.search.includes('jk=') ||
         document.querySelector('[data-testid="job-details"]') !== null ||
         document.querySelector('.jobsearch-JobComponent') !== null ||
         document.querySelector('[id*="jobDetails"]') !== null;
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
  
  // Check if this is a new job that needs a refresh
  const newJobId = extractJobIdFromUrl();
  if (newJobId && currentJobId && newJobId !== currentJobId && !isProcessingJobChange) {
    log(`Job ID changed from ${currentJobId} to ${newJobId} - triggering refresh`);
    currentJobId = newJobId;
    fastRefreshForNewJob();
    return;
  }
  
  // Set current job ID if not set
  if (!currentJobId && newJobId) {
    currentJobId = newJobId;
    log('Set initial job ID:', currentJobId);
  }
  
  // Wait for page to load
  await waitForElement('.jobsearch-JobComponent, [data-testid="job-details"], [id*="jobDetails"]', 3000);
  
  // Try extraction with retries
  let attempts = 0;
  const maxAttempts = 3;
  
  const tryExtraction = () => {
    attempts++;
    log(`Extraction attempt ${attempts}/${maxAttempts}`);
    
    const data = extractJobData();
    if (data) {
      displayInsights(data);
    } else if (attempts < maxAttempts) {
      setTimeout(tryExtraction, 1500);
    } else {
      log('Could not extract job data after', maxAttempts, 'attempts');
      
      // Check if we're on a filtered search vs general browsing
      const hasSearchFilters = window.location.search.includes('q=') || 
                              window.location.search.includes('l=') ||
                              window.location.search.includes('sort=') ||
                              window.location.search.includes('radius=');
      
      if (!hasSearchFilters) {
        log('No search filters detected - showing data quality warning');
        showDataQualityWarning();
      } else {
        log('Search filters present but data extraction failed - showing error panel');
        showErrorPanel();
      }
    }
  };
  
  tryExtraction();
}

// Function to show warning about potentially unreliable job data
function showDataQualityWarning() {
  const panel = document.createElement('div');
  panel.id = 'indeed-insights-panel';
  panel.innerHTML = `
    <div class="insights-header">
      <h3>Job Data Quality Notice</h3>
      <button class="close-btn">&times;</button>
    </div>
    <div class="insights-content">
      <div style="padding: 16px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
        <p style="color: #d73502; font-weight: 600; margin-bottom: 12px;">
          This job may not have detailed hiring data
        </p>
        <p style="color: #666; font-size: 14px; margin-bottom: 16px;">
          Jobs without detailed metadata might be:
        </p>
        <ul style="color: #666; font-size: 13px; text-align: left; margin: 0; padding-left: 20px;">
          <li>Older or less actively managed postings</li>
          <li>Sponsored/promoted content</li>
          <li>General "always hiring" positions</li>
        </ul>
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #f0f0f0;">
          <p style="color: #2557a7; font-size: 13px; margin-bottom: 12px;">
            <strong>💡 Tip:</strong> Try using search filters for more reliable results
          </p>
          <button id="manual-refresh" style="background: #2557a7; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px;">
            Refresh for Data
          </button>
        </div>
      </div>
    </div>
  `;
  
  panel.querySelector('.close-btn').addEventListener('click', () => {
    panel.remove();
  });
  
  panel.querySelector('#manual-refresh').addEventListener('click', () => {
    fastRefreshForNewJob();
  });
  
  document.body.appendChild(panel);
  isProcessingJobChange = false;
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
        <button id="manual-refresh" style="background: #2557a7; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
          Refresh for Data
        </button>
      </p>
    </div>
  `;
  
  panel.querySelector('.close-btn').addEventListener('click', () => {
    panel.remove();
  });
  
  panel.querySelector('#manual-refresh').addEventListener('click', () => {
    fastRefreshForNewJob();
  });
  
  document.body.appendChild(panel);
  isProcessingJobChange = false;
}

// Enhanced URL change detection
let lastUrl = location.href;
let urlChangeTimeout = null;

function handleUrlChange() {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    log('URL changed to:', url);
    
    if (urlChangeTimeout) {
      clearTimeout(urlChangeTimeout);
    }
    
    // Quick response to URL changes
    urlChangeTimeout = setTimeout(() => {
      if (isJobDetailPage()) {
        runExtraction();
      }
    }, 100); // Very fast response
  }
}

// Check if URL has refresh parameter and clean it
function cleanRefreshParameter() {
  const url = new URL(window.location);
  if (url.searchParams.has('_r')) {
    url.searchParams.delete('_r');
    // Use replaceState to clean the URL without triggering another navigation
    window.history.replaceState({}, '', url.toString());
    log('Cleaned refresh parameter from URL - this was a refresh for new job data');
    // Reset suppression flag since we're now on the fresh page
    suppressPanelDisplay = false;
    isProcessingJobChange = false;
  }
}

// Initialize
log('Indeed Insights Extension loaded');

// Clean refresh parameter if present
cleanRefreshParameter();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    currentJobId = extractJobIdFromUrl();
    setTimeout(runExtraction, 500);
  });
} else {
  currentJobId = extractJobIdFromUrl();
  setTimeout(runExtraction, 500);
}

// Listen for URL changes with very fast response
new MutationObserver(handleUrlChange).observe(document, {
  subtree: true, 
  childList: true
});

window.addEventListener('popstate', handleUrlChange);

// Keyboard shortcuts for debugging
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'I') {
    log('Manual extraction triggered');
    runExtraction();
  }
  
  if (e.ctrlKey && e.shiftKey && e.key === 'R') {
    log('Manual refresh triggered');
    isProcessingJobChange = false;
    fastRefreshForNewJob();
  }
});
