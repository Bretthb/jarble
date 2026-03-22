// ---------------------------------------------------------------------------
// Structured test prompts for canvas component E2E testing
// ---------------------------------------------------------------------------

export interface TestPrompt {
  id: string;
  prompt: string;
  expectedComponents: string[];
  group: string;
  description: string;
  interactive?: {
    action: "click" | "fill" | "submit" | "evaluate";
    target: string;
    value?: string;
  };
  expectBotFollowup?: boolean;
}

// Legacy export for backward-compat with existing spec files
export const COMPONENT_PROMPTS: Array<{
  prompt: string;
  expectedComponents: string[];
  description: string;
}> = [
  {
    prompt: "Show me a bar chart of the top 5 programming languages by popularity",
    expectedComponents: ["chart"],
    description: "bar-chart",
  },
  {
    prompt: "Create a data table showing 5 fictional employees with name, role, department, and salary",
    expectedComponents: ["data_table"],
    description: "data-table",
  },
  {
    prompt: "Show me a stat grid with 4 key metrics: revenue ($1.2M), users (45K), growth (23%), and churn (2.1%)",
    expectedComponents: ["stat_grid"],
    description: "stat-grid",
  },
  {
    prompt: "Create an informational card about quantum computing with a title and body paragraph",
    expectedComponents: ["card"],
    description: "card",
  },
  {
    prompt: "Show me an alert warning about scheduled maintenance tonight at 11pm",
    expectedComponents: ["alert"],
    description: "alert",
  },
  {
    prompt: "Show me a code block with a Python function that calculates fibonacci numbers",
    expectedComponents: ["code_block"],
    description: "code-block",
  },
];

// ==========================================================================
// FILE 1: canvas-render-display.spec.ts — Display Components Part 1
// ==========================================================================

export const DISPLAY_PROMPTS_1: TestPrompt[] = [
  {
    id: "render-card-01",
    prompt: "Create an informational card with the title 'Machine Learning Basics' and a body paragraph explaining supervised vs unsupervised learning.",
    expectedComponents: ["card"],
    group: "display",
    description: "card with title and body",
  },
  {
    id: "render-alert-01",
    prompt: "Show me an alert with type 'warning' about scheduled maintenance tonight at 11pm EST. Include the message 'All services will be briefly unavailable.'",
    expectedComponents: ["alert"],
    group: "display",
    description: "warning alert",
  },
  {
    id: "render-alert-02",
    prompt: "Show me a success alert confirming that the payment was processed. Title it 'Payment Confirmed'.",
    expectedComponents: ["alert"],
    group: "display",
    description: "success alert",
  },
  {
    id: "render-badge-01",
    prompt: "Show me a set of 5 badges for different statuses: Active (green), Pending (yellow), Inactive (red), Beta (blue), New (purple). Use the badge component.",
    expectedComponents: ["badge"],
    group: "display",
    description: "colored badges",
  },
  {
    id: "render-progress-01",
    prompt: "Show me a progress bar at 65% completion with the label 'Upload Progress'.",
    expectedComponents: ["progress"],
    group: "display",
    description: "progress bar",
  },
  {
    id: "render-image-01",
    prompt: "Show me an image component displaying the URL https://picsum.photos/400/300 with alt text 'Sample landscape' and a caption 'Random landscape photo'.",
    expectedComponents: ["image"],
    group: "display",
    description: "image with caption",
  },
  {
    id: "render-codeblock-01",
    prompt: "Show me a code block with a Python function that calculates fibonacci numbers using recursion. Use the language 'python'.",
    expectedComponents: ["code_block"],
    group: "display",
    description: "python code block",
  },
  {
    id: "render-codeblock-02",
    prompt: "Show me a code block with a TypeScript React component that renders a hello world button. Use the language 'typescript'.",
    expectedComponents: ["code_block"],
    group: "display",
    description: "typescript code block",
  },
  {
    id: "render-divider-01",
    prompt: "Show me a divider component with the label 'Section Break' in the center.",
    expectedComponents: ["divider"],
    group: "display",
    description: "labeled divider",
  },
  {
    id: "render-header-01",
    prompt: "Show me a header component with the title 'Q4 Performance Report', subtitle '2025 Annual Review', and level 2.",
    expectedComponents: ["header"],
    group: "display",
    description: "header with subtitle",
  },
  {
    id: "render-avatar-01",
    prompt: "Show me an avatar component with the name 'John Doe', the image URL https://i.pravatar.cc/150?img=3, and size 'large'.",
    expectedComponents: ["avatar"],
    group: "display",
    description: "avatar with image",
  },
  {
    id: "render-blockquote-01",
    prompt: "Show me a blockquote with the text 'The only way to do great work is to love what you do.' attributed to Steve Jobs.",
    expectedComponents: ["blockquote"],
    group: "display",
    description: "blockquote with attribution",
  },
];

// ==========================================================================
// FILE 2: canvas-render-display-2.spec.ts — Display Components Part 2
// ==========================================================================

export const DISPLAY_PROMPTS_2: TestPrompt[] = [
  {
    id: "render-textmsg-01",
    prompt: "Show me a text_message component with the content 'Welcome to Jarble! Here is your personalized dashboard.' and variant 'info'.",
    expectedComponents: ["text_message"],
    group: "display",
    description: "text message info",
  },
  {
    id: "render-statistic-01",
    prompt: "Show me a single statistic component with the label 'Monthly Revenue', value '$125,430', and a positive change of '+12.5%'.",
    expectedComponents: ["statistic"],
    group: "display",
    description: "single statistic",
  },
  {
    id: "render-result-01",
    prompt: "Show me a result component with status 'success', title 'Order Placed Successfully', and subtitle 'Order #12345 has been confirmed.'",
    expectedComponents: ["result"],
    group: "display",
    description: "success result",
  },
  {
    id: "render-timeline-01",
    prompt: "Show me a timeline with 4 events: 'Order Placed' (Jan 1), 'Processing' (Jan 2), 'Shipped' (Jan 3), 'Delivered' (Jan 5). Each with a brief description.",
    expectedComponents: ["timeline"],
    group: "display",
    description: "timeline with events",
  },
  {
    id: "render-list-01",
    prompt: "Show me a list component with 5 items: 'Set up development environment', 'Write unit tests', 'Implement authentication', 'Add API endpoints', 'Deploy to production'. Include descriptions for each.",
    expectedComponents: ["list"],
    group: "display",
    description: "list with descriptions",
  },
  {
    id: "render-tagcloud-01",
    prompt: "Show me a tag cloud with these tags and weights: JavaScript (90), Python (85), TypeScript (80), React (75), Node.js (70), Docker (60), Kubernetes (50), AWS (45).",
    expectedComponents: ["tag_cloud"],
    group: "display",
    description: "weighted tag cloud",
  },
  {
    id: "render-descriptions-01",
    prompt: "Show me a descriptions component listing: Name: 'John Smith', Email: 'john@example.com', Role: 'Senior Engineer', Department: 'Platform', Status: 'Active'.",
    expectedComponents: ["descriptions"],
    group: "display",
    description: "descriptions list",
  },
  {
    id: "render-tree-01",
    prompt: "Show me a tree component with a file system structure: src/ containing index.ts, components/ (with Header.tsx, Footer.tsx), and utils/ (with helpers.ts).",
    expectedComponents: ["tree"],
    group: "display",
    description: "file tree",
  },
  {
    id: "render-steps-01",
    prompt: "Show me a steps component with 4 steps: 'Account Setup' (completed), 'Configure Bot' (current), 'Connect Platform' (upcoming), 'Deploy' (upcoming).",
    expectedComponents: ["steps"],
    group: "display",
    description: "steps indicator",
  },
  {
    id: "render-carousel-01",
    prompt: "Show me a carousel with 3 slides: slide 1 titled 'Feature A' about real-time analytics, slide 2 titled 'Feature B' about AI integration, slide 3 titled 'Feature C' about team collaboration.",
    expectedComponents: ["carousel"],
    group: "display",
    description: "carousel slides",
  },
];

// ==========================================================================
// FILE 3: canvas-render-data.spec.ts — Charts, Tables, Metrics
// ==========================================================================

export const DATA_PROMPTS: TestPrompt[] = [
  {
    id: "render-barchart-01",
    prompt: "Show me a bar chart of the top 5 programming languages by popularity: JavaScript (68%), Python (65%), Java (35%), TypeScript (30%), C# (25%).",
    expectedComponents: ["chart"],
    group: "data",
    description: "bar chart",
  },
  {
    id: "render-linechart-01",
    prompt: "Show me a line chart of monthly revenue for 2025: Jan $45K, Feb $52K, Mar $48K, Apr $61K, May $58K, Jun $72K. Use the type 'line'.",
    expectedComponents: ["chart"],
    group: "data",
    description: "line chart",
  },
  {
    id: "render-piechart-01",
    prompt: "Show me a pie chart of browser market share: Chrome 65%, Safari 18%, Firefox 8%, Edge 5%, Other 4%. Use the type 'pie'.",
    expectedComponents: ["chart"],
    group: "data",
    description: "pie chart",
  },
  {
    id: "render-areachart-01",
    prompt: "Show me an area chart of daily active users over a week: Mon 1200, Tue 1350, Wed 1500, Thu 1420, Fri 1600, Sat 900, Sun 850. Use the type 'area'.",
    expectedComponents: ["chart"],
    group: "data",
    description: "area chart",
  },
  {
    id: "render-stackedchart-01",
    prompt: "Show me a stacked bar chart comparing sales by region (North, South, East, West) across Q1, Q2, Q3, Q4 with realistic values.",
    expectedComponents: ["chart"],
    group: "data",
    description: "stacked bar chart",
  },
  {
    id: "render-datatable-01",
    prompt: "Create a data table showing 8 fictional employees with columns: Name, Role, Department, Salary, Start Date. Include realistic data.",
    expectedComponents: ["data_table"],
    group: "data",
    description: "data table with 8 rows",
  },
  {
    id: "render-statgrid-01",
    prompt: "Show me a stat grid with 6 metrics: Total Revenue ($2.4M, +15%), Active Users (128K, +8%), Conversion Rate (3.2%, -0.5%), Avg Session (4m 32s, +12%), Bounce Rate (32%, -3%), Page Views (890K, +22%).",
    expectedComponents: ["stat_grid"],
    group: "data",
    description: "stat grid with 6 metrics",
  },
  {
    id: "render-keyvalue-01",
    prompt: "Show me a key_value component with these pairs: API Version: v2.3.1, Status: Healthy, Uptime: 99.97%, Last Deploy: 2 hours ago, Region: us-east-1.",
    expectedComponents: ["key_value"],
    group: "data",
    description: "key-value pairs",
  },
  {
    id: "render-metriccard-01",
    prompt: "Show me a metric_card with label 'Monthly Active Users', value '45,231', change '+12.3%', and a positive trend.",
    expectedComponents: ["metric_card"],
    group: "data",
    description: "single metric card",
  },
  {
    id: "render-map-01",
    prompt: "Show me a map centered on San Francisco (37.7749, -122.4194) with zoom level 12 and a marker at that location with the label 'Jarble HQ'.",
    expectedComponents: ["map"],
    group: "data",
    description: "map with marker",
  },
];

// ==========================================================================
// FILE 4: canvas-render-interactive.spec.ts — Interactive Component Rendering
// ==========================================================================

export const INTERACTIVE_RENDER_PROMPTS: TestPrompt[] = [
  {
    id: "render-buttons-01",
    prompt: "Show me a button_group with 3 buttons: 'Approve' (primary variant), 'Reject' (destructive), and 'Skip' (outline). Use the button_group component.",
    expectedComponents: ["button_group"],
    group: "interactive-render",
    description: "button group render",
  },
  {
    id: "render-form-01",
    prompt: "Show me a form with fields: Name (text, required), Email (email, required), Role (select with options: Developer, Designer, Manager), and a Subscribe checkbox. Include a Submit button.",
    expectedComponents: ["form"],
    group: "interactive-render",
    description: "form with mixed fields",
  },
  {
    id: "render-tabs-01",
    prompt: "Show me a tabs component with 3 tabs: 'Overview' with a summary paragraph, 'Details' with a bullet list of features, and 'Settings' with configuration info.",
    expectedComponents: ["tabs"],
    group: "interactive-render",
    description: "tabs with content",
  },
  {
    id: "render-accordion-01",
    prompt: "Show me an accordion with 4 sections: 'What is Jarble?' (explanation text), 'Pricing' (pricing details), 'Supported Platforms' (platform list), 'Getting Started' (setup steps).",
    expectedComponents: ["accordion"],
    group: "interactive-render",
    description: "accordion with sections",
  },
  {
    id: "render-codeeditor-01",
    prompt: "Show me a code_editor with a sample JavaScript function that sorts an array, using the language 'javascript'. Make it editable.",
    expectedComponents: ["code_editor"],
    group: "interactive-render",
    description: "code editor",
  },
  {
    id: "render-sandbox-01",
    prompt: "Create a sandbox that shows a red circle using HTML canvas. The circle should be centered in the sandbox with a radius of 50 pixels.",
    expectedComponents: ["sandbox"],
    group: "interactive-render",
    description: "sandbox with canvas",
  },
  {
    id: "render-layout-01",
    prompt: "Show me a layout component with direction 'horizontal' containing two children: a card titled 'Left Panel' and a card titled 'Right Panel'.",
    expectedComponents: ["layout"],
    group: "interactive-render",
    description: "horizontal layout",
  },
  {
    id: "render-gallery-01",
    prompt: "Show me an image_gallery with 4 images from https://picsum.photos with IDs 100, 200, 300, 400 (each 300x200). Add captions for each.",
    expectedComponents: ["image_gallery"],
    group: "interactive-render",
    description: "image gallery",
  },
  {
    id: "render-form-02",
    prompt: "Show me a form with a textarea field labeled 'Feedback', a rating select (1-5), and a submit button labeled 'Send Feedback'.",
    expectedComponents: ["form"],
    group: "interactive-render",
    description: "feedback form",
  },
  {
    id: "render-tabs-02",
    prompt: "Show me tabs with 2 tabs: 'Code' containing a code_block with a hello world function, and 'Preview' containing a card with the output.",
    expectedComponents: ["tabs"],
    group: "interactive-render",
    description: "tabs with nested components",
  },
];

// ==========================================================================
// FILE 5: canvas-interaction-buttons.spec.ts — Button & Click Interactions
// ==========================================================================

export const BUTTON_INTERACTION_PROMPTS: TestPrompt[] = [
  {
    id: "interact-btn-01",
    prompt: "Show me a button_group with buttons: 'Option A', 'Option B', 'Option C'. When I click one, tell me which I chose.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "button click → bot acknowledges",
    interactive: { action: "click", target: "Option A" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-02",
    prompt: "Show me a button_group with 'Yes' and 'No' buttons for a simple confirmation prompt: 'Do you want to proceed?'",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "yes/no confirmation buttons",
    interactive: { action: "click", target: "Yes" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-03",
    prompt: "Show me a button_group with 4 color options: 'Red', 'Blue', 'Green', 'Yellow'. Tell me my favorite color based on my choice.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "multi-option button selection",
    interactive: { action: "click", target: "Blue" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-04",
    prompt: "Show me a button_group with an 'Approve' button (primary) and a 'Reject' button (destructive) for reviewing a document.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "approve/reject styled buttons",
    interactive: { action: "click", target: "Approve" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-05",
    prompt: "Show a button_group with 'Start', 'Pause', 'Reset' buttons for a timer control. When I click Start, confirm the timer started.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "timer control buttons",
    interactive: { action: "click", target: "Start" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-06",
    prompt: "Create a bar chart of quarterly sales: Q1 $100K, Q2 $150K, Q3 $120K, Q4 $180K. Make it interactive so I can click bars.",
    expectedComponents: ["chart"],
    group: "interaction-buttons",
    description: "chart bar click",
  },
  {
    id: "interact-btn-07",
    prompt: "Show me a pie chart of department budgets: Engineering 40%, Marketing 25%, Sales 20%, HR 15%. Make it interactive.",
    expectedComponents: ["chart"],
    group: "interaction-buttons",
    description: "pie chart slice click",
  },
  {
    id: "interact-btn-08",
    prompt: "Show me a button_group with a single 'Generate Report' button. Tell me what report you would generate when I click it.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "single action button",
    interactive: { action: "click", target: "Generate Report" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-09",
    prompt: "Show me a button_group with 'Easy', 'Medium', 'Hard' difficulty buttons for a quiz. When I pick one, describe that difficulty level.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "difficulty selection buttons",
    interactive: { action: "click", target: "Medium" },
    expectBotFollowup: true,
  },
  {
    id: "interact-btn-10",
    prompt: "Show me a button_group with 'English', 'Spanish', 'French' buttons. When I pick one, greet me in that language.",
    expectedComponents: ["button_group"],
    group: "interaction-buttons",
    description: "language selection buttons",
    interactive: { action: "click", target: "French" },
    expectBotFollowup: true,
  },
];

// ==========================================================================
// FILE 6: canvas-interaction-forms.spec.ts — Form Interactions
// ==========================================================================

export const FORM_INTERACTION_PROMPTS: TestPrompt[] = [
  {
    id: "interact-form-01",
    prompt: "Show me a form with fields: 'Full Name' (text, required) and 'Email' (email, required). When I submit, confirm the details I entered.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "simple form submit",
    interactive: { action: "fill", target: "Full Name", value: "Test User" },
    expectBotFollowup: true,
  },
  {
    id: "interact-form-02",
    prompt: "Show me a form with a 'Message' textarea and a 'Priority' select (Low, Medium, High, Critical). Submit button labeled 'Send'.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "textarea + select form",
  },
  {
    id: "interact-form-03",
    prompt: "Show me a contact form with: Name (text), Email (email), Subject (text), and Message (textarea). All fields required. Submit button says 'Send Message'.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "contact form",
  },
  {
    id: "interact-form-04",
    prompt: "Show me a form for creating a new project: Project Name (text, required), Description (textarea), Team Size (number), and a 'Create Project' submit button.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "project creation form",
  },
  {
    id: "interact-form-05",
    prompt: "Show me a feedback form with: Rating (select 1-5), 'What did you like?' (textarea), 'What could improve?' (textarea), and a Submit button.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "feedback form with rating",
  },
  {
    id: "interact-form-06",
    prompt: "Show me a login form with Username (text, required), Password (text, required), and a 'Remember me' checkbox. Login button at bottom.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "login form",
  },
  {
    id: "interact-form-07",
    prompt: "Show me a settings form with: Notification Email (email), Theme (select: Light, Dark, Auto), Language (select: English, Spanish, French), and Save button.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "settings form",
  },
  {
    id: "interact-form-08",
    prompt: "Show me a registration form with: First Name, Last Name, Email, Password, Confirm Password. All required. Register button.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "registration form",
  },
  {
    id: "interact-form-09",
    prompt: "Show me a search form with a single 'Search Query' text field with placeholder 'Enter search terms...' and a 'Search' button.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "search form",
  },
  {
    id: "interact-form-10",
    prompt: "Show me an event form with: Event Name (text), Date (text), Location (text), Description (textarea), Max Attendees (number). Create Event button.",
    expectedComponents: ["form"],
    group: "interaction-forms",
    description: "event creation form",
  },
];

// ==========================================================================
// FILE 7: canvas-interaction-sandbox.spec.ts — Sandbox Interactions
// ==========================================================================

export const SANDBOX_PROMPTS: TestPrompt[] = [
  {
    id: "sandbox-01",
    prompt: "Create a sandbox with a simple HTML page that has a blue background, a centered heading 'Hello Sandbox', and a paragraph below it.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "basic HTML sandbox",
  },
  {
    id: "sandbox-02",
    prompt: "Create a sandbox with a counter: a heading showing '0', and two buttons 'Increment' and 'Decrement'. Use JavaScript to make them work.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "interactive counter sandbox",
  },
  {
    id: "sandbox-03",
    prompt: "Create a sandbox that draws a rotating 3D cube using Three.js. Load Three.js from CDN (https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js).",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "Three.js 3D sandbox",
  },
  {
    id: "sandbox-04",
    prompt: "Create a sandbox with a simple CSS animation: a red square that bounces up and down continuously using CSS keyframes.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "CSS animation sandbox",
  },
  {
    id: "sandbox-05",
    prompt: "Create a sandbox that shows the current time updating every second using JavaScript setInterval. Display it in a large centered font.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "live clock sandbox",
  },
  {
    id: "sandbox-06",
    prompt: "Create a sandbox with a simple drawing canvas. Users should be able to draw with mouse clicks/drags on an HTML5 canvas element.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "drawing canvas sandbox",
  },
  {
    id: "sandbox-07",
    prompt: "Create a sandbox with a color picker: show 6 colored squares (red, blue, green, yellow, purple, orange). Clicking one changes the background color.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "color picker sandbox",
  },
  {
    id: "sandbox-08",
    prompt: "Create a sandbox with a simple calculator that has number buttons (0-9), operator buttons (+, -, *, /), and an equals button with a display area.",
    expectedComponents: ["sandbox"],
    group: "sandbox",
    description: "calculator sandbox",
  },
];

// ==========================================================================
// FILE 8: canvas-update-ui.spec.ts — In-Place Card Updates
// ==========================================================================

export const UPDATE_UI_PROMPTS: TestPrompt[] = [
  {
    id: "update-01",
    prompt: "Create a card titled 'Status: Pending'. Then I will ask you to update it.",
    expectedComponents: ["card"],
    group: "update-ui",
    description: "create card for update",
  },
  {
    id: "update-02",
    prompt: "Create a stat_grid showing: Users (1000), Revenue ($50K), Growth (5%). Then I will ask you to update the values.",
    expectedComponents: ["stat_grid"],
    group: "update-ui",
    description: "create stat grid for update",
  },
  {
    id: "update-03",
    prompt: "Create a progress bar at 25% with the label 'Download Progress'. Then I'll ask you to update the progress.",
    expectedComponents: ["progress"],
    group: "update-ui",
    description: "create progress for update",
  },
  {
    id: "update-04",
    prompt: "Create a bar chart showing monthly data: Jan 10, Feb 20, Mar 30. Then I'll ask you to add more months.",
    expectedComponents: ["chart"],
    group: "update-ui",
    description: "create chart for update",
  },
  {
    id: "update-05",
    prompt: "Create a data table with 3 rows of employee data. Then I'll ask you to add more rows.",
    expectedComponents: ["data_table"],
    group: "update-ui",
    description: "create table for update",
  },
];

export const UPDATE_UI_FOLLOWUPS: TestPrompt[] = [
  {
    id: "update-follow-01",
    prompt: "Now update the card title to 'Status: Complete' and change the body to say 'All tasks finished successfully.'",
    expectedComponents: ["card"],
    group: "update-ui",
    description: "update card title and body",
  },
  {
    id: "update-follow-02",
    prompt: "Now update the stat grid: Users should be 2500, Revenue $120K, Growth 15%.",
    expectedComponents: ["stat_grid"],
    group: "update-ui",
    description: "update stat grid values",
  },
  {
    id: "update-follow-03",
    prompt: "Now update the progress bar to 75%.",
    expectedComponents: ["progress"],
    group: "update-ui",
    description: "update progress value",
  },
  {
    id: "update-follow-04",
    prompt: "Now add April (40), May (50), and June (60) to the bar chart.",
    expectedComponents: ["chart"],
    group: "update-ui",
    description: "update chart with more data",
  },
  {
    id: "update-follow-05",
    prompt: "Now add 2 more employee rows to the data table.",
    expectedComponents: ["data_table"],
    group: "update-ui",
    description: "update table with more rows",
  },
];

// ==========================================================================
// FILE 9: canvas-save-load.spec.ts — Save/Load Cycle
// ==========================================================================

export const SAVE_LOAD_PROMPTS: TestPrompt[] = [
  {
    id: "save-01",
    prompt: "Create a stat grid with 4 metrics: Revenue ($500K), Users (25K), Uptime (99.9%), Tickets (42). I want to save this for later.",
    expectedComponents: ["stat_grid"],
    group: "save-load",
    description: "create component to save",
  },
  {
    id: "save-02",
    prompt: "Save the current canvas to a file called 'my-dashboard'.",
    expectedComponents: [],
    group: "save-load",
    description: "save canvas file",
    expectBotFollowup: true,
  },
  {
    id: "save-03",
    prompt: "List all saved canvas files.",
    expectedComponents: [],
    group: "save-load",
    description: "list saved files",
    expectBotFollowup: true,
  },
  {
    id: "save-04",
    prompt: "Load the saved canvas file called 'my-dashboard'.",
    expectedComponents: ["stat_grid"],
    group: "save-load",
    description: "load saved file",
    expectBotFollowup: true,
  },
  {
    id: "save-05",
    prompt: "Delete the saved canvas file called 'my-dashboard'.",
    expectedComponents: [],
    group: "save-load",
    description: "delete saved file",
    expectBotFollowup: true,
  },
  {
    id: "save-06",
    prompt: "Create a bar chart showing Q1-Q4 revenue data and save it as 'quarterly-chart'.",
    expectedComponents: ["chart"],
    group: "save-load",
    description: "create and save chart",
    expectBotFollowup: true,
  },
  {
    id: "save-07",
    prompt: "Load the saved file 'quarterly-chart'.",
    expectedComponents: ["chart"],
    group: "save-load",
    description: "load saved chart",
    expectBotFollowup: true,
  },
  {
    id: "save-08",
    prompt: "Try to load a file called 'nonexistent-file-12345'.",
    expectedComponents: [],
    group: "save-load",
    description: "load nonexistent file (error case)",
    expectBotFollowup: true,
  },
  {
    id: "save-09",
    prompt: "Delete the saved file 'quarterly-chart'.",
    expectedComponents: [],
    group: "save-load",
    description: "cleanup saved chart",
    expectBotFollowup: true,
  },
  {
    id: "save-10",
    prompt: "List all saved canvas files to confirm cleanup.",
    expectedComponents: [],
    group: "save-load",
    description: "verify cleanup",
    expectBotFollowup: true,
  },
];

// ==========================================================================
// FILE 10: canvas-custom-components.spec.ts — define_component & render
// ==========================================================================

export const CUSTOM_COMPONENT_PROMPTS: TestPrompt[] = [
  {
    id: "custom-01",
    prompt: "Define a custom component called 'status_badge' that displays a label and a color-coded status (online/offline/away). It should have props: name (string), status (string), and lastSeen (string).",
    expectedComponents: [],
    group: "custom-components",
    description: "define custom component",
    expectBotFollowup: true,
  },
  {
    id: "custom-02",
    prompt: "Now render the status_badge component with: name 'Alice', status 'online', lastSeen '2 minutes ago'.",
    expectedComponents: [],
    group: "custom-components",
    description: "render custom component",
  },
  {
    id: "custom-03",
    prompt: "Render the status_badge again with: name 'Bob', status 'offline', lastSeen '3 hours ago'.",
    expectedComponents: [],
    group: "custom-components",
    description: "render custom with different data",
  },
  {
    id: "custom-04",
    prompt: "List all available components including any custom ones I defined.",
    expectedComponents: [],
    group: "custom-components",
    description: "list components includes custom",
    expectBotFollowup: true,
  },
  {
    id: "custom-05",
    prompt: "Show me the component reference for status_badge.",
    expectedComponents: [],
    group: "custom-components",
    description: "component reference for custom",
    expectBotFollowup: true,
  },
  {
    id: "custom-06",
    prompt: "Define a custom component called 'project_card' with props: projectName (string), progress (number), team (string), deadline (string). Use a card layout with a progress bar.",
    expectedComponents: [],
    group: "custom-components",
    description: "define second custom component",
    expectBotFollowup: true,
  },
  {
    id: "custom-07",
    prompt: "Render project_card with: projectName 'Jarble v2', progress 65, team 'Platform', deadline 'March 2026'.",
    expectedComponents: [],
    group: "custom-components",
    description: "render second custom component",
  },
  {
    id: "custom-08",
    prompt: "Try to render a component called 'nonexistent_widget'. Tell me what happens.",
    expectedComponents: [],
    group: "custom-components",
    description: "unknown component fallback",
    expectBotFollowup: true,
  },
];

// ==========================================================================
// FILE 11: canvas-dashboard-ops.spec.ts — Canvas Operations
// ==========================================================================

export const DASHBOARD_OPS_PROMPTS: TestPrompt[] = [
  {
    id: "dashops-split-01",
    prompt: "Show me a stat grid with 4 metrics: Revenue ($1.2M), Users (45K), Growth (23%), Churn (2.1%). I want to split these into individual cards.",
    expectedComponents: ["stat_grid"],
    group: "dashboard-ops",
    description: "stat grid for splitting",
  },
  {
    id: "dashops-close-01",
    prompt: "Show me a card with the title 'Temporary Note' and body 'This card will be closed.'",
    expectedComponents: ["card"],
    group: "dashboard-ops",
    description: "card for close test",
  },
  {
    id: "dashops-multi-01",
    prompt: "Show me a card titled 'Card One' with body 'First card content.'",
    expectedComponents: ["card"],
    group: "dashboard-ops",
    description: "first of multiple cards",
  },
  {
    id: "dashops-multi-02",
    prompt: "Show me a bar chart of monthly sales: Jan $10K, Feb $15K, Mar $20K.",
    expectedComponents: ["chart"],
    group: "dashboard-ops",
    description: "second card for accumulation",
  },
  {
    id: "dashops-multi-03",
    prompt: "Show me a data table with 3 rows: Product A ($50), Product B ($75), Product C ($100).",
    expectedComponents: ["data_table"],
    group: "dashboard-ops",
    description: "third card for accumulation",
  },
];

// ==========================================================================
// FILE 12: canvas-error-recovery.spec.ts — Error Cards & Recovery
// ==========================================================================

export const ERROR_RECOVERY_PROMPTS: TestPrompt[] = [
  {
    id: "error-01",
    prompt: "Show me a chart component but intentionally use an empty data array with no xAxisKey.",
    expectedComponents: ["chart"],
    group: "error-recovery",
    description: "chart with minimal/empty data",
  },
  {
    id: "error-02",
    prompt: "Show me a progress bar with value 200 (which exceeds 100%).",
    expectedComponents: ["progress"],
    group: "error-recovery",
    description: "progress bar with overflow value",
  },
  {
    id: "error-03",
    prompt: "Show me a data table with columns but zero rows of data.",
    expectedComponents: ["data_table"],
    group: "error-recovery",
    description: "empty data table",
  },
  {
    id: "error-04",
    prompt: "Create a card with an extremely long title consisting of 500 characters and see how it renders.",
    expectedComponents: ["card"],
    group: "error-recovery",
    description: "extremely long text handling",
  },
  {
    id: "error-05",
    prompt: "Show me a stat grid where some stats have missing values — some without labels, some without values.",
    expectedComponents: ["stat_grid"],
    group: "error-recovery",
    description: "stat grid with missing fields",
  },
  {
    id: "error-06",
    prompt: "Create a sandbox with intentionally broken JavaScript: `const x = ; console.log(x);`. Show how the error is displayed.",
    expectedComponents: ["sandbox"],
    group: "error-recovery",
    description: "sandbox with broken JS",
  },
  {
    id: "error-07",
    prompt: "Show me a chart with mismatched data — the xAxisKey references a field that doesn't exist in the data objects.",
    expectedComponents: ["chart"],
    group: "error-recovery",
    description: "chart with wrong xAxisKey",
  },
  {
    id: "error-08",
    prompt: "Create an image component with a completely invalid URL: 'not-a-url'.",
    expectedComponents: ["image"],
    group: "error-recovery",
    description: "image with invalid URL",
  },
  {
    id: "error-09",
    prompt: "Show me a form with zero fields — just a submit button.",
    expectedComponents: ["form"],
    group: "error-recovery",
    description: "form with no fields",
  },
  {
    id: "error-10",
    prompt: "Create a tabs component with 0 tabs.",
    expectedComponents: ["tabs"],
    group: "error-recovery",
    description: "tabs with no tabs",
  },
];

// ==========================================================================
// FILE 13: canvas-memory-system.spec.ts — Store/Recall/Forget Facts
// ==========================================================================

export const MEMORY_PROMPTS: TestPrompt[] = [
  {
    id: "memory-01",
    prompt: "Remember that my favorite programming language is TypeScript.",
    expectedComponents: [],
    group: "memory",
    description: "store fact",
    expectBotFollowup: true,
  },
  {
    id: "memory-02",
    prompt: "What is my favorite programming language?",
    expectedComponents: [],
    group: "memory",
    description: "recall fact",
    expectBotFollowup: true,
  },
  {
    id: "memory-03",
    prompt: "Remember that my team name is 'Platform Engineering' and we have 12 members.",
    expectedComponents: [],
    group: "memory",
    description: "store complex fact",
    expectBotFollowup: true,
  },
  {
    id: "memory-04",
    prompt: "What do you know about my team?",
    expectedComponents: [],
    group: "memory",
    description: "recall complex fact",
    expectBotFollowup: true,
  },
  {
    id: "memory-05",
    prompt: "Remember that my project deadline is March 15, 2026.",
    expectedComponents: [],
    group: "memory",
    description: "store date fact",
    expectBotFollowup: true,
  },
  {
    id: "memory-06",
    prompt: "What do you remember about me? List everything.",
    expectedComponents: [],
    group: "memory",
    description: "recall all facts",
    expectBotFollowup: true,
  },
  {
    id: "memory-07",
    prompt: "Actually, my favorite programming language has changed to Rust. Update your memory.",
    expectedComponents: [],
    group: "memory",
    description: "overwrite memory",
    expectBotFollowup: true,
  },
  {
    id: "memory-08",
    prompt: "What is my favorite programming language now?",
    expectedComponents: [],
    group: "memory",
    description: "recall updated fact",
    expectBotFollowup: true,
  },
];

// ==========================================================================
// FILE 14: canvas-multi-dashboard.spec.ts — Complex Multi-Component Layouts
// ==========================================================================

export const MULTI_DASHBOARD_PROMPTS: TestPrompt[] = [
  {
    id: "multi-01",
    prompt: "Create a complete analytics dashboard with: a header titled 'Sales Dashboard', a stat grid with 4 KPIs (Revenue, Orders, AOV, Conversion), a bar chart of monthly sales, and a data table of top 5 products. Render all of them.",
    expectedComponents: ["header", "stat_grid", "chart", "data_table"],
    group: "multi-dashboard",
    description: "full analytics dashboard",
  },
  {
    id: "multi-02",
    prompt: "Create tabs with 3 tabs: 'Revenue' containing a line chart of monthly revenue, 'Users' containing a bar chart of user growth, and 'Summary' containing a stat grid.",
    expectedComponents: ["tabs"],
    group: "multi-dashboard",
    description: "tabs with nested charts",
  },
  {
    id: "multi-03",
    prompt: "Create an accordion with 3 sections: 'Financial Overview' with a stat grid, 'Sales Trend' with a line chart, 'Team Performance' with a data table.",
    expectedComponents: ["accordion"],
    group: "multi-dashboard",
    description: "accordion with nested components",
  },
  {
    id: "multi-04",
    prompt: "Show me a layout with 3 columns: left column has a metric card, middle column has a chart, right column has a list of top items.",
    expectedComponents: ["layout"],
    group: "multi-dashboard",
    description: "multi-column layout",
  },
  {
    id: "multi-05",
    prompt: "Create a project status board: a header, a steps component showing project phases, a progress bar at 60%, and a timeline of recent milestones.",
    expectedComponents: ["header", "steps", "progress", "timeline"],
    group: "multi-dashboard",
    description: "project status board",
  },
  {
    id: "multi-06",
    prompt: "Show me a card with a title, then a divider, then a stat grid with 3 metrics, then another divider, then a code block with a JSON config example.",
    expectedComponents: ["card", "divider", "stat_grid", "code_block"],
    group: "multi-dashboard",
    description: "mixed components sequence",
  },
  {
    id: "multi-07",
    prompt: "Create an employee directory: a data table with 10 employees (name, role, email, department), and a pie chart showing department distribution.",
    expectedComponents: ["data_table", "chart"],
    group: "multi-dashboard",
    description: "table + chart combination",
  },
  {
    id: "multi-08",
    prompt: "Create a monitoring dashboard: 4 metric cards in a stat grid (CPU, Memory, Disk, Network), a line chart of CPU usage over time, and an alert about high memory usage.",
    expectedComponents: ["stat_grid", "chart", "alert"],
    group: "multi-dashboard",
    description: "monitoring dashboard",
  },
  {
    id: "multi-09",
    prompt: "Create a user profile page: an avatar, a header with user name, a descriptions component with user details, a timeline of recent activity, and a button group with Edit Profile and Settings.",
    expectedComponents: ["avatar", "header", "descriptions", "timeline", "button_group"],
    group: "multi-dashboard",
    description: "user profile layout",
  },
  {
    id: "multi-10",
    prompt: "Create an API documentation page: a header, tabs with 'Endpoints' (data table of routes), 'Authentication' (code block), and 'Examples' (multiple code blocks).",
    expectedComponents: ["header", "tabs"],
    group: "multi-dashboard",
    description: "API docs layout",
  },
];

// ==========================================================================
// FILE 15: canvas-edit-persist.spec.ts — Editable Components & Persistence
// ==========================================================================

export const EDIT_PERSIST_PROMPTS: TestPrompt[] = [
  {
    id: "edit-01",
    prompt: "Create a data table of 5 employees with Name, Role, and Salary. Make it editable.",
    expectedComponents: ["data_table"],
    group: "edit-persist",
    description: "editable data table",
  },
  {
    id: "edit-02",
    prompt: "Show me a code editor with a Python hello world script. Make it editable.",
    expectedComponents: ["code_editor"],
    group: "edit-persist",
    description: "editable code editor",
  },
  {
    id: "edit-03",
    prompt: "Create a card titled 'Notes' with body text 'Add your notes here'. Make it editable.",
    expectedComponents: ["card"],
    group: "edit-persist",
    description: "editable card",
  },
  {
    id: "edit-04",
    prompt: "Show me a stat grid with 3 metrics: Users (100), Revenue ($10K), Growth (5%). Make it editable.",
    expectedComponents: ["stat_grid"],
    group: "edit-persist",
    description: "editable stat grid",
  },
];

// ==========================================================================
// FILE 16: canvas-edge-cases.spec.ts — Edge Cases & Security
// ==========================================================================

export const EDGE_CASE_PROMPTS: TestPrompt[] = [
  {
    id: "edge-xss-01",
    prompt: "Create a card with the title '<script>alert(\"xss\")</script>' and body '<img src=x onerror=alert(1)>'. This is a security test.",
    expectedComponents: ["card"],
    group: "edge-cases",
    description: "XSS attempt in card",
  },
  {
    id: "edge-unicode-01",
    prompt: "Create a card with the title 'Emoji Test: \u{1F680}\u{1F30D}\u{2728}\u{1F4CA}\u{1F3AF}' and body containing Japanese text '\u3053\u3093\u306B\u3061\u306F\u4E16\u754C' and Arabic '\u0645\u0631\u062D\u0628\u0627'.",
    expectedComponents: ["card"],
    group: "edge-cases",
    description: "unicode and emoji content",
  },
  {
    id: "edge-large-01",
    prompt: "Create a data table with 50 rows of sample data. Each row should have columns: ID (1-50), Name, Email, City, Score (random 1-100).",
    expectedComponents: ["data_table"],
    group: "edge-cases",
    description: "large data table (50 rows)",
  },
  {
    id: "edge-special-01",
    prompt: "Create a key_value component with special characters in keys: 'user.name', 'config[0]', 'path/to/file', 'key=value', 'multi word key'.",
    expectedComponents: ["key_value"],
    group: "edge-cases",
    description: "special characters in field names",
  },
  {
    id: "edge-empty-01",
    prompt: "Create a card with an empty title '' and an empty body ''.",
    expectedComponents: ["card"],
    group: "edge-cases",
    description: "empty string content",
  },
  {
    id: "edge-long-01",
    prompt: "Create a card with a very long body that is 2000 characters. Write a full essay about the history of computing filling the space.",
    expectedComponents: ["card"],
    group: "edge-cases",
    description: "very long text content",
  },
  {
    id: "edge-number-01",
    prompt: "Create a stat grid where all values are extreme: one is 0, one is -999, one is 999999999, one is 0.000001.",
    expectedComponents: ["stat_grid"],
    group: "edge-cases",
    description: "extreme numeric values",
  },
  {
    id: "edge-html-01",
    prompt: "Create a card with body text containing HTML entities: &amp; &lt; &gt; &quot; &#39; and markdown **bold** *italic* `code`.",
    expectedComponents: ["card"],
    group: "edge-cases",
    description: "HTML entities and markdown in content",
  },
  {
    id: "edge-nested-01",
    prompt: "Create a layout containing a layout containing a layout containing a card. Test 3 levels of nesting.",
    expectedComponents: ["layout"],
    group: "edge-cases",
    description: "deeply nested layouts",
  },
  {
    id: "edge-duplicate-01",
    prompt: "Create two identical cards both titled 'Duplicate Test' with the same body 'This tests duplicate handling.'",
    expectedComponents: ["card"],
    group: "edge-cases",
    description: "duplicate components",
  },
];

// ==========================================================================
// FILE 17: canvas-media.spec.ts — Media Components
// ==========================================================================

export const MEDIA_PROMPTS: TestPrompt[] = [
  {
    id: "media-video-01",
    prompt: "Show me a video component with a sample video URL. Use https://www.w3schools.com/html/mov_bbb.mp4 as the source.",
    expectedComponents: ["video"],
    group: "media",
    description: "video player",
  },
  {
    id: "media-audio-01",
    prompt: "Show me an audio component with a sample audio URL. Use https://www.w3schools.com/html/horse.mp3 as the source.",
    expectedComponents: ["audio"],
    group: "media",
    description: "audio player",
  },
  {
    id: "media-image-01",
    prompt: "Show me an image component displaying https://picsum.photos/600/400 with the caption 'Beautiful landscape' and alt text 'Landscape photo'.",
    expectedComponents: ["image"],
    group: "media",
    description: "image with fallback test",
  },
  {
    id: "media-gallery-01",
    prompt: "Show me an image gallery with 6 images from https://picsum.photos using IDs 10, 20, 30, 40, 50, 60 (each 300x200). Add captions: 'Photo 1' through 'Photo 6'.",
    expectedComponents: ["image_gallery"],
    group: "media",
    description: "image gallery",
  },
  {
    id: "media-carousel-01",
    prompt: "Show me a carousel with 4 slides: each slide has a title ('Feature 1' through 'Feature 4') and a description paragraph.",
    expectedComponents: ["carousel"],
    group: "media",
    description: "carousel navigation",
  },
  {
    id: "media-broken-01",
    prompt: "Show me an image component with a broken URL: 'https://example.com/nonexistent-image.jpg'. This tests error fallback.",
    expectedComponents: ["image"],
    group: "media",
    description: "broken image fallback",
  },
];

// ==========================================================================
// FILE 18: canvas-schema-validation.spec.ts — AutoFix & Alias Resolution
// ==========================================================================

export const SCHEMA_VALIDATION_PROMPTS: TestPrompt[] = [
  {
    id: "schema-01",
    prompt: "Show me a progress bar with the value as the string '75' (not a number). The autoFix system should coerce this to a number.",
    expectedComponents: ["progress"],
    group: "schema-validation",
    description: "string-to-number coercion",
  },
  {
    id: "schema-02",
    prompt: "Show me a chart with type 'Bar' (capital B). The autoFix should normalize this to 'bar'.",
    expectedComponents: ["chart"],
    group: "schema-validation",
    description: "enum normalization",
  },
  {
    id: "schema-03",
    prompt: "Show me a card component using the alias name 'info_card' if you have that alias.",
    expectedComponents: ["card"],
    group: "schema-validation",
    description: "component name alias",
  },
  {
    id: "schema-04",
    prompt: "Show me a sandbox component but call it 'canvas' in the component type.",
    expectedComponents: ["sandbox"],
    group: "schema-validation",
    description: "canvas → sandbox alias",
  },
  {
    id: "schema-05",
    prompt: "Show me a stat grid where the stats array uses 'title' instead of 'label' for each stat name. AutoFix should fix the field mapping.",
    expectedComponents: ["stat_grid"],
    group: "schema-validation",
    description: "field alias resolution",
  },
  {
    id: "schema-06",
    prompt: "Show me a data table. Use the component name 'table' instead of 'data_table'.",
    expectedComponents: ["data_table"],
    group: "schema-validation",
    description: "table → data_table alias",
  },
  {
    id: "schema-07",
    prompt: "Show me a chart where the data is provided as a flat array of numbers [10, 20, 30, 40, 50] instead of objects. AutoFix should handle this.",
    expectedComponents: ["chart"],
    group: "schema-validation",
    description: "chart data shape fix",
  },
  {
    id: "schema-08",
    prompt: "Create a card with both 'body' and 'content' fields set to the same text. AutoFix should handle the duplicate.",
    expectedComponents: ["card"],
    group: "schema-validation",
    description: "duplicate field handling",
  },
  {
    id: "schema-09",
    prompt: "Show me a stat grid with a single stat instead of an array. AutoFix should wrap it in an array.",
    expectedComponents: ["stat_grid"],
    group: "schema-validation",
    description: "single item → array coercion",
  },
  {
    id: "schema-10",
    prompt: "Show me a button_group where the buttons have 'text' instead of 'label' for their display text.",
    expectedComponents: ["button_group"],
    group: "schema-validation",
    description: "button text → label alias",
  },
];

// ==========================================================================
// Helper: get all prompts for a group
// ==========================================================================

export function getPromptsByGroup(group: string): TestPrompt[] {
  const allPrompts = [
    ...DISPLAY_PROMPTS_1,
    ...DISPLAY_PROMPTS_2,
    ...DATA_PROMPTS,
    ...INTERACTIVE_RENDER_PROMPTS,
    ...BUTTON_INTERACTION_PROMPTS,
    ...FORM_INTERACTION_PROMPTS,
    ...SANDBOX_PROMPTS,
    ...UPDATE_UI_PROMPTS,
    ...UPDATE_UI_FOLLOWUPS,
    ...SAVE_LOAD_PROMPTS,
    ...CUSTOM_COMPONENT_PROMPTS,
    ...DASHBOARD_OPS_PROMPTS,
    ...ERROR_RECOVERY_PROMPTS,
    ...MEMORY_PROMPTS,
    ...MULTI_DASHBOARD_PROMPTS,
    ...EDIT_PERSIST_PROMPTS,
    ...EDGE_CASE_PROMPTS,
    ...MEDIA_PROMPTS,
    ...SCHEMA_VALIDATION_PROMPTS,
  ];
  return allPrompts.filter((p) => p.group === group);
}

/** Total prompt count for verification. */
export const TOTAL_PROMPT_COUNT =
  DISPLAY_PROMPTS_1.length +
  DISPLAY_PROMPTS_2.length +
  DATA_PROMPTS.length +
  INTERACTIVE_RENDER_PROMPTS.length +
  BUTTON_INTERACTION_PROMPTS.length +
  FORM_INTERACTION_PROMPTS.length +
  SANDBOX_PROMPTS.length +
  UPDATE_UI_PROMPTS.length +
  UPDATE_UI_FOLLOWUPS.length +
  SAVE_LOAD_PROMPTS.length +
  CUSTOM_COMPONENT_PROMPTS.length +
  DASHBOARD_OPS_PROMPTS.length +
  ERROR_RECOVERY_PROMPTS.length +
  MEMORY_PROMPTS.length +
  MULTI_DASHBOARD_PROMPTS.length +
  EDIT_PERSIST_PROMPTS.length +
  EDGE_CASE_PROMPTS.length +
  MEDIA_PROMPTS.length +
  SCHEMA_VALIDATION_PROMPTS.length;
