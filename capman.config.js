// Enriched by capman --enrich-examples

module.exports = {
  "app": "swagger-petstore",
  "baseUrl": "https://petstore.swagger.io/v2",
  "capabilities": [
    {
      "id": "find_pets_by_status",
      "name": "Finds Pets by status",
      "description": "Multiple status values can be provided with comma separated strings",
      "examples": [
        "Finds Pets by status",
        "Multiple status values can be provided with comma separated strings",
        "Finds Pets by status by status",
        "Show me pets with a specific status",
        "Pet status finder",
        "Get pets by their current status",
        "Find pets that are available",
        "Pet status search",
        "Pets by status code",
        "Find pets with a certain status",
        "Status-based pet search",
        "Pet finder by status",
        "Get available pets",
        "Search pets by their status",
        "Pet status lookup",
        "Find pets in a certain status",
        "Status-specific pet finder",
        "Show pets by status"
      ],
      "params": [
        {
          "name": "status",
          "description": "Status values that need to be considered for filter",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "findByStatus"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "GET",
            "path": "/pet/findByStatus"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "find_pets_by_tags",
      "name": "Finds Pets by tags",
      "description": "Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.",
      "examples": [
        "Finds Pets by tags",
        "Multiple tags can be provided with comma separated strings",
        "Finds Pets by tags by tags",
        "Pet tag search",
        "Find pets with specific tags",
        "Tag-based pet finder",
        "Get pets by their tags",
        "Pet tags search",
        "Find pets with certain tags",
        " Pets by tag name",
        "Tag-specific pet search",
        "Show pets with tags",
        "Pet finder by tags",
        "Search pets by their tags",
        "Find pets tagged with",
        "Pet tag lookup",
        "Get pets with specific tags",
        "Tagged pet search"
      ],
      "params": [
        {
          "name": "tags",
          "description": "Tags to filter by",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "findByTags"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "GET",
            "path": "/pet/findByTags"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "get_pet_by_id",
      "name": "Find pet by ID",
      "description": "Returns a single pet",
      "examples": [
        "Find pet by ID",
        "Returns a single pet",
        "Find pet by ID by pet id",
        "Show me a pet by its ID",
        "Pet ID lookup",
        "Find pet by its identifier",
        "Get a pet by its unique ID",
        "Pet identifier search",
        "Find a pet using its ID",
        "Pet ID finder",
        "Show pet details by ID",
        "Get pet information by ID",
        "Pet details by ID",
        "Find pet by unique ID",
        "Pet ID search",
        "Show a pet by its ID",
        "Pet info by ID",
        "Get a pet's details by ID"
      ],
      "params": [
        {
          "name": "pet_id",
          "description": "ID of pet to return",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "pet"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "GET",
            "path": "/pet/{petId}"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "get_inventory",
      "name": "Returns pet inventories by status",
      "description": "Returns a map of status codes to quantities",
      "examples": [
        "Returns pet inventories by status",
        "Returns a map of status codes to quantities",
        "Show me the pet inventory",
        "Pet stock levels",
        "Get the current inventory",
        "Pet inventory lookup",
        "Show pet quantities",
        "Inventory of pets",
        "Pet stock search",
        "Current pet inventory",
        "Find pet quantities",
        "Pet inventory search",
        "Show inventory levels",
        "Get inventory quantities",
        "Pet stock lookup",
        "Inventory lookup",
        "Show pet inventory levels"
      ],
      "params": [],
      "returns": [
        "inventory"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "GET",
            "path": "/store/inventory"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "get_order_by_id",
      "name": "Find purchase order by ID",
      "description": "For valid response try integer IDs with value >= 1 and <= 10. Other values will generated exceptions",
      "examples": [
        "Find purchase order by ID",
        "For valid response try integer IDs with value >= 1 and <= 10",
        "Find purchase order by ID by order id",
        "Show me an order by its ID",
        "Order ID lookup",
        "Find order by its identifier",
        "Get an order by its unique ID",
        "Order identifier search",
        "Find an order using its ID",
        "Order ID finder",
        "Show order details by ID",
        "Get order information by ID",
        "Order details by ID",
        "Find order by unique ID",
        "Order ID search",
        "Show an order by its ID",
        "Order info by ID",
        "Get an order's details by ID"
      ],
      "params": [
        {
          "name": "order_id",
          "description": "ID of pet that needs to be fetched",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "order"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "GET",
            "path": "/store/order/{orderId}"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "delete_order",
      "name": "Delete purchase order by ID",
      "description": "For valid response try integer IDs with positive integer value. Negative or non-integer values will generate API errors",
      "examples": [
        "Delete purchase order by ID",
        "For valid response try integer IDs with positive integer value",
        "Delete purchase order by ID by order id",
        "Cancel an order by ID",
        "Remove an order",
        "Delete an order using its ID",
        "Order cancellation",
        "Order removal",
        "Cancel order by ID",
        "Order deletion",
        "Remove order by ID",
        "Delete order by ID number",
        "Order ID cancellation",
        "Cancel a purchase order",
        "Remove purchase order",
        "Purchase order cancellation",
        "Delete an order"
      ],
      "params": [
        {
          "name": "order_id",
          "description": "ID of the order that needs to be deleted",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "order"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "DELETE",
            "path": "/store/order/{orderId}"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "update_user",
      "name": "Updated user",
      "description": "This can only be done by the logged in user.",
      "examples": [
        "Updated user",
        "This can only be done by the logged in user",
        "Updated user by username and body",
        "Update my user info",
        "Change user details",
        "Edit user profile",
        "Update user profile info",
        "Modify user information",
        "Update user data",
        "Change my user settings",
        "Edit my profile",
        "Update my profile",
        "Modify my user info",
        "User profile update",
        "User info update",
        "Update user account",
        "Modify user profile",
        "Edit user account"
      ],
      "params": [
        {
          "name": "username",
          "description": "name that need to be updated",
          "required": true,
          "source": "user_query"
        },
        {
          "name": "body",
          "description": "Updated user object",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "user"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "PUT",
            "path": "/user/{username}"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "delete_user",
      "name": "Delete user",
      "description": "This can only be done by the logged in user.",
      "examples": [
        "Delete user",
        "This can only be done by the logged in user",
        "Delete user by username",
        "Remove my user account",
        "Delete my profile",
        "Cancel my account",
        "Remove user profile",
        "Delete user info",
        "User account deletion",
        "Delete my user info",
        "Remove my profile",
        "Cancel user account",
        "Delete user profile",
        "User profile removal",
        "User account removal",
        "Delete my account",
        "Remove my user info",
        "User deletion"
      ],
      "params": [
        {
          "name": "username",
          "description": "The name that needs to be deleted",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "user"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "DELETE",
            "path": "/user/{username}"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    },
    {
      "id": "create_user",
      "name": "Create user",
      "description": "This can only be done by the logged in user.",
      "examples": [
        "Create user",
        "This can only be done by the logged in user",
        "Create user by body",
        "Create a new user",
        "Add a new user",
        "Make a new user account",
        "New user registration",
        "Create user profile",
        "Add new user",
        "Create a user account",
        "New user creation",
        "Register a new user",
        "Create new user profile",
        "Add a user",
        "New user setup",
        "Create user info",
        "Make a new profile",
        "User creation"
      ],
      "params": [
        {
          "name": "body",
          "description": "Created user object",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": [
        "user"
      ],
      "resolver": {
        "type": "api",
        "endpoints": [
          {
            "method": "POST",
            "path": "/user"
          }
        ]
      },
      "privacy": {
        "level": "user_owned"
      }
    }
  ]
}
