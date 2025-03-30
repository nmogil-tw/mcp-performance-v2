document.addEventListener('DOMContentLoaded', async () => {
    // Update the last updated date
    document.getElementById('lastUpdated').textContent = new Date().toLocaleString();
    
    // Load and display dynamic metrics
    await loadAndDisplayMetrics();
});

async function loadAndDisplayMetrics() {
    try {
        // Fetch metrics data
        const response = await fetch('/metrics/summary.json');
        const data = await response.json();
        
        // Separate control and MCP sessions
        const controlSessions = data.filter(s => s.mode === 'control');
        const mcpSessions = data.filter(s => s.mode === 'mcp');
        
        if (controlSessions.length === 0 || mcpSessions.length === 0) {
            console.error('No data available for either control or MCP sessions');
            return;
        }
        
        // Calculate key metrics
        const metrics = calculateKeyMetrics(controlSessions, mcpSessions);
        
        // Update the DOM
        updateMetricsDisplay(metrics);
    } catch (error) {
        console.error('Error loading metrics data:', error);
    }
}

function calculateKeyMetrics(controlSessions, mcpSessions) {
    // Calculate averages for each metric
    const avgControlDuration = average(controlSessions.map(s => s.duration)) / 1000; // Convert to seconds
    const avgMcpDuration = average(mcpSessions.map(s => s.duration)) / 1000;
    
    const avgControlCalls = average(controlSessions.map(s => s.apiCalls));
    const avgMcpCalls = average(mcpSessions.map(s => s.apiCalls));
    
    const avgControlInteractions = average(controlSessions.map(s => s.interactions));
    const avgMcpInteractions = average(mcpSessions.map(s => s.interactions));
    
    const controlSuccessRate = percentage(controlSessions.filter(s => s.success).length, controlSessions.length);
    const mcpSuccessRate = percentage(mcpSessions.filter(s => s.success).length, mcpSessions.length);
    
    // Calculate percentage changes
    return {
        timeEfficiency: percentageChange(avgMcpDuration, avgControlDuration),
        apiCallsReduction: percentageChange(avgMcpCalls, avgControlCalls),
        interactionReduction: percentageChange(avgMcpInteractions, avgControlInteractions),
        successRate: mcpSuccessRate.toFixed(0)
    };
}

function updateMetricsDisplay(metrics) {
    // Update the DOM elements with calculated metrics
    document.getElementById('timeEfficiency').textContent = `${metrics.timeEfficiency}%`;
    document.getElementById('apiCallsReduction').textContent = `${metrics.apiCallsReduction}%`;
    document.getElementById('interactionReduction').textContent = `${metrics.interactionReduction}%`;
    document.getElementById('successRate').textContent = `${metrics.successRate}%`;
}

// Helper functions (reused from dashboard.js)
function average(values) {
    const validValues = values.filter(val => val !== null);
    return validValues.length ? validValues.reduce((sum, val) => sum + (val || 0), 0) / validValues.length : 0;
}

function percentage(part, total) {
    return total ? (part / total) * 100 : 0;
}

function percentageChange(newValue, oldValue) {
    return oldValue ? (((newValue - oldValue) / oldValue) * 100).toFixed(1) : 'N/A';
}
