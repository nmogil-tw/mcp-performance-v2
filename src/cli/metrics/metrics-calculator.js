const logger = require('../../utils/logger');

class MetricsCalculator {
  constructor(segment, testType) {
    this.segment = segment;
    this.testType = testType;
  }

  async calculate() {
    try {
      // Check for MCP usage in API calls
      const hasMcpUsage = this.checkForMcpUsage();
      const finalMode = hasMcpUsage ? 'mcp' : (this.segment.testType || this.testType);

      // Calculate metrics in parallel
      const [
        apiCallCount,
        userMessageCount,
        tokenMetrics,
        model
      ] = await Promise.all([
        this.calculateApiCalls(),
        this.calculateUserMessages(),
        this.calculateTokenMetrics(),
        this.determineModel()
      ]);

      const { tokensIn, tokensOut, totalCost } = tokenMetrics;

      return {
        taskId: this.segment.taskNumber,
        directoryId: this.segment.directoryId,
        mode: finalMode,
        model: model,
        mcpServer: 'Twilio', // Default value
        mcpClient: 'Cline', // Changed from 'Cursor' to 'Cline'
        startTime: this.segment.startTime,
        endTime: this.segment.endTime,
        duration: this.segment.endTime - this.segment.startTime,
        apiCalls: apiCallCount,
        interactions: userMessageCount,
        tokensIn: tokensIn,
        tokensOut: tokensOut,
        totalTokens: tokensIn + tokensOut,
        cost: totalCost,
        success: true,
        notes: ''
      };
    } catch (error) {
      logger.error(`Error calculating metrics: ${error.message}`);
      return null;
    }
  }

  checkForMcpUsage() {
    for (const apiCall of this.segment.apiCalls) {
      if (apiCall.role === 'assistant' && apiCall.content && Array.isArray(apiCall.content)) {
        for (const content of apiCall.content) {
          if (content.type === 'text' && content.text && 
              (content.text.includes('use_mcp_tool') || 
               content.text.includes('use_mcp_server') || 
               content.text.includes('access_mcp_resource'))) {
            return true;
          }
        }
      }
    }
    return false;
  }

  async calculateApiCalls() {
    let apiCallCount = 0;
    
    // Count API calls from UI messages only - only counting api_req_started events
    for (const msg of this.segment.userMessages) {
      // Count API request operations
      if (msg.type === 'say' && msg.say === 'api_req_started') {
        apiCallCount++;
        logger.debug(`Found API request in task ${this.segment.taskNumber}: ${msg.text}`);
      }
      
      // No longer counting MCP tool requests as per requirements
    }

    logger.info(`API Call Count for Task ${this.segment.taskNumber}: ${apiCallCount}`);

    return apiCallCount || 0;
  }

  async calculateUserMessages() {
    // For each task, we should count exactly one user interaction
    // This should be the initial task message from the API conversation history
    
    // Look for the initial task message in the API calls
    for (const apiCall of this.segment.apiCalls) {
      if (apiCall.role === 'user' && apiCall.content && Array.isArray(apiCall.content)) {
        // Check if this is the initial task message
        const isTaskMessage = apiCall.content.some(content => 
          content.type === 'text' && 
          content.text && (
            content.text.includes('<task>') || 
            content.text.includes('Complete Task') ||
            content.text.includes('agent-instructions/mcp_instructions.md') ||
            content.text.includes('agent-instructions/control_instructions.md')
          )
        );
        
        if (isTaskMessage) {
          logger.info(`Found initial task message for task ${this.segment.taskNumber}`);
          return 1;
        }
      }
    }
    
    // If no initial task message is found, still return 1
    logger.info(`No initial task message found, defaulting to 1 interaction for task ${this.segment.taskNumber}`);
    return 1;
  }

  async calculateTokenMetrics() {
    let tokensIn = 0;
    let tokensOut = 0;
    let totalCost = 0;
    let messagesWithTokens = 0;

    logger.info(`Starting token calculation for task ${this.segment.taskNumber}`);

    // First pass: Collect reported token usage from Claude
    for (const message of this.segment.userMessages) {
      if (message.type === 'say' && message.text) {
        try {
          const data = JSON.parse(message.text);
          if (data.tokensIn !== undefined) {
            tokensIn += parseInt(data.tokensIn, 10);
            tokensOut += parseInt(data.tokensOut || 0, 10);
            totalCost += parseFloat(data.cost || 0);
            messagesWithTokens++;
            logger.info(`Message ${messagesWithTokens} tokens - In: ${data.tokensIn}, Out: ${data.tokensOut || 0}`);
          }
        } catch (e) {
          // If JSON parsing fails, try regex matching
          const tokensInMatch = message.text.match(/tokensIn["\s:]+(\d+)/i);
          const tokensOutMatch = message.text.match(/tokensOut["\s:]+(\d+)/i);
          const costMatch = message.text.match(/cost["\s:]+([0-9.]+)/i);

          if (tokensInMatch || tokensOutMatch) {
            if (tokensInMatch && tokensInMatch[1]) tokensIn += parseInt(tokensInMatch[1], 10);
            if (tokensOutMatch && tokensOutMatch[1]) tokensOut += parseInt(tokensOutMatch[1], 10);
            if (costMatch && costMatch[1]) totalCost += parseFloat(costMatch[1]);
            messagesWithTokens++;
            logger.info(`Message ${messagesWithTokens} tokens - In: ${tokensInMatch ? tokensInMatch[1] : 0}, Out: ${tokensOutMatch ? tokensOutMatch[1] : 0}`);
          }
        }
      }
    }

    // Second pass: Check API calls for any additional token usage
    let apiCallsWithTokens = 0;
    for (const apiCall of this.segment.apiCalls) {
      if (apiCall.usage) {
        if (apiCall.usage.input_tokens) tokensIn += apiCall.usage.input_tokens;
        if (apiCall.usage.output_tokens) tokensOut += apiCall.usage.output_tokens;
        if (apiCall.usage.cost) totalCost += apiCall.usage.cost;
        apiCallsWithTokens++;
        logger.info(`API Call ${apiCallsWithTokens} tokens - In: ${apiCall.usage.input_tokens || 0}, Out: ${apiCall.usage.output_tokens || 0}`);
      }
    }

    // Calculate total cost if not already set
    if (totalCost === 0) {
      // Claude-3 pricing: $0.008/1K input tokens, $0.024/1K output tokens
      totalCost = (tokensIn * 0.008 / 1000) + (tokensOut * 0.024 / 1000);
    }

    logger.info(`Token metrics for task ${this.segment.taskNumber}:
      Messages with tokens: ${messagesWithTokens}
      API calls with tokens: ${apiCallsWithTokens}
      Total input tokens: ${tokensIn}
      Total output tokens: ${tokensOut}
      Total cost: ${totalCost}`);

    return { tokensIn, tokensOut, totalCost };
  }

  async determineModel() {
    for (const apiCall of this.segment.apiCalls) {
      if (apiCall.role === 'assistant' && apiCall.content && Array.isArray(apiCall.content)) {
        for (const content of apiCall.content) {
          if (content.type === 'text' && content.text) {
            // Look for model in system prompt
            const systemPromptMatch = content.text.match(/You are a powerful agentic AI coding assistant, powered by Claude 3\.5 Sonnet/i);
            if (systemPromptMatch) {
              return 'claude-3.7-sonnet';  // Return the correct model name
            }
          }
        }
      }
    }
    
    // Default to the correct model if not found in logs
    return 'claude-3.7-sonnet';
  }
}

module.exports = MetricsCalculator;
