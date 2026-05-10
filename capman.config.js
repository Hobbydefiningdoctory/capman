// Enriched by capman --enrich-examples

module.exports = {
  "app": "conversational-ai-assistant",
  "baseUrl": "https://api.conversational-ai-assistant.com",
  "capabilities": [
    {
      "id": "generate_text",
      "name": "Text Generation",
      "description": "Generate human-like text based on a given prompt or topic",
      "examples": [
        "Write a story about a character who learns a new skill",
        "Create a product description for a new smartwatch",
        "Compose an email to a friend about a recent trip",
        "Create a script for a podcast episode on a popular topic",
        "Develop a blog post about a social issue",
        "Write a letter to a historical figure",
        "Generate a sales pitch for a new product",
        "Produce a poem about a personal experience",
        "Craft a dialogue between two characters with different perspectives",
        "Make a list of instructions for a DIY project",
        "Design a welcome message for a website",
        "Come up with a motivational speech for a sports team",
        "Construct a press release for a new business launch",
        "Write a character sketch of a fictional person",
        "Develop a set of guidelines for a community event",
        "Create a synopsis of a movie plot",
        "Generate a description of a fictional world",
        "Produce a eulogy for a historical figure",
        "Craft a personal statement for a job application",
        "Make a set of predictions for a future industry trend",
        "Design a product label for a new food item",
        "Write a scene for a play",
        "Develop a set of FAQs for a customer support page"
      ],
      "params": [
        {
          "name": "prompt",
          "description": "The text prompt to generate content from",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "text"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "POST",
            "path": "/generate/text"
          }
        ]
      },
      "privacy": {
        "level": "public"
      }
    },
    {
      "id": "code_generation",
      "name": "Code Generation",
      "description": "Generate code snippets in various programming languages based on a given specification",
      "examples": [
        "Create a Python function to sort a list of numbers",
        "Write a JavaScript script to validate user input",
        "Generate a Java class to represent a bank account",
        "Generate a C++ function to implement a binary search algorithm",
        "Write a Ruby script to parse a JSON file",
        "Create a Swift class to model a social media post",
        "Produce a PHP function to handle user authentication",
        "Develop a Go program to simulate a banking system",
        "Make a Java method to calculate the area of a geometric shape",
        "Design a Python module to interact with a database",
        "Craft a JavaScript function to create a dynamic chart",
        "Generate a TypeScript interface to define a data structure",
        "Create a Kotlin function to implement a sorting algorithm",
        "Write a Perl script to process a text file",
        "Develop a Haskell program to simulate a game",
        "Produce a Lua function to handle user input",
        "Make a C# class to model a financial transaction",
        "Design a MATLAB function to analyze a dataset",
        "Generate a R script to visualize a statistical model",
        "Create a SQL query to retrieve data from a database",
        "Craft a Julia function to optimize a mathematical equation",
        "Develop a VB.NET program to automate a task"
      ],
      "params": [
        {
          "name": "language",
          "description": "The programming language to generate code in",
          "required": true,
          "source": "user_query"
        },
        {
          "name": "specification",
          "description": "The specification of the code to generate",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "code"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "POST",
            "path": "/generate/code"
          }
        ]
      },
      "privacy": {
        "level": "public"
      }
    },
    {
      "id": "summarization",
      "name": "Summarization",
      "description": "Summarize a given piece of text into a shorter summary",
      "examples": [
        "Summarize a news article about a recent event",
        "Summarize a research paper on a complex topic",
        "Summarize a book review",
        "Summarize a scientific article on a recent breakthrough",
        "Condense a long document into a brief summary",
        "Extract key points from a conference presentation",
        "Create a summary of a company's annual report",
        "Distill a complex concept into a simple summary",
        "Generate a summary of a historical event",
        "Produce a summary of a medical research study",
        "Make a summary of a technical manual",
        "Write a summary of a famous speech",
        "Develop a summary of a business plan",
        "Create a summary of a travel guide",
        "Summarize a self-help book",
        "Condense a large dataset into a concise summary",
        "Extract the main ideas from a philosophical text",
        "Generate a summary of a news broadcast",
        "Produce a summary of a user manual",
        "Make a summary of a environmental report",
        "Write a summary of a cultural event",
        "Develop a summary of a policy document"
      ],
      "params": [
        {
          "name": "text",
          "description": "The text to summarize",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "summary"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "POST",
            "path": "/summarize"
          }
        ]
      },
      "privacy": {
        "level": "public"
      }
    },
    {
      "id": "recommendation",
      "name": "Recommendation",
      "description": "Provide recommendations based on a given context or user input",
      "examples": [
        "Recommend a movie based on my favorite genre",
        "Suggest a book based on my reading history",
        "Propose a travel destination based on my interests",
        "Suggest a gift for a friend based on their interests",
        "Recommend a restaurant based on a user's dietary preferences",
        "Propose a vacation package based on a user's budget",
        "Generate a list of books based on a user's reading history",
        "Create a personalized workout plan based on a user's fitness goals",
        "Develop a music playlist based on a user's favorite artists",
        "Make a list of movie recommendations based on a user's favorite genres",
        "Design a personalized learning plan based on a user's learning style",
        "Write a list of product recommendations based on a user's purchase history",
        "Generate a list of travel destinations based on a user's preferences",
        "Produce a list of courses based on a user's career goals",
        "Create a personalized nutrition plan based on a user's health goals",
        "Recommend a smartphone based on a user's usage patterns",
        "Suggest a hobby based on a user's interests",
        "Develop a list of TV show recommendations based on a user's viewing history",
        "Make a list of video game recommendations based on a user's gaming preferences",
        "Write a list of podcast recommendations based on a user's listening history",
        "Generate a list of event recommendations based on a user's attendance history"
      ],
      "params": [
        {
          "name": "context",
          "description": "The context or user input to provide recommendations for",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "recommendations"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "GET",
            "path": "/recommend"
          }
        ]
      },
      "privacy": {
        "level": "public"
      }
    },
    {
      "id": "task_automation",
      "name": "Task Automation",
      "description": "Automate tasks such as drafting emails, brainstorming ideas, or explaining complex topics",
      "examples": [
        "Draft an email to a client about a project update",
        "Brainstorm ideas for a new marketing campaign",
        "Explain a complex topic like artificial intelligence to a beginner",
        "Automate the process of sending reminders to clients",
        "Generate a social media post schedule for a business",
        "Develop a script to automate data entry tasks",
        "Create a template for a common email response",
        "Produce a workflow to automate routine tasks",
        "Make a macro to automate a repetitive task in a spreadsheet",
        "Write a program to automate the backup of important files",
        "Generate a set of instructions to automate a complex process",
        "Design a system to automate the assignment of tasks to team members",
        "Craft a script to automate the generation of reports",
        "Develop a tool to automate the translation of text",
        "Create a bot to automate customer support tasks",
        "Produce a workflow to automate the approval process for documents",
        "Make a script to automate the migration of data between systems",
        "Write a program to automate the monitoring of system performance",
        "Generate a set of rules to automate decision-making tasks",
        "Design a system to automate the synchronization of files across devices",
        "Craft a script to automate the creation of presentations",
        "Develop a tool to automate the analysis of data"
      ],
      "params": [
        {
          "name": "task",
          "description": "The task to automate",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "result"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "POST",
            "path": "/automate"
          }
        ]
      },
      "privacy": {
        "level": "public"
      }
    }
  ]
}
