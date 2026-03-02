export const COMPONENT_PROMPTS: Array<{
  prompt: string;
  expectedComponents: string[];
  description: string;
}> = [
  {
    prompt:
      "Show me a bar chart of the top 5 programming languages by popularity",
    expectedComponents: ["chart"],
    description: "bar-chart",
  },
  {
    prompt:
      "Create a data table showing 5 fictional employees with name, role, department, and salary",
    expectedComponents: ["data_table"],
    description: "data-table",
  },
  {
    prompt:
      "Show me a stat grid with 4 key metrics: revenue ($1.2M), users (45K), growth (23%), and churn (2.1%)",
    expectedComponents: ["stat_grid"],
    description: "stat-grid",
  },
  {
    prompt:
      "Create an informational card about quantum computing with a title and body paragraph",
    expectedComponents: ["card"],
    description: "card",
  },
  {
    prompt:
      "Show me an alert warning about scheduled maintenance tonight at 11pm",
    expectedComponents: ["alert"],
    description: "alert",
  },
  {
    prompt:
      "Show me a code block with a Python function that calculates fibonacci numbers",
    expectedComponents: ["code_block"],
    description: "code-block",
  },
];
