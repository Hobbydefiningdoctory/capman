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
        "What pets are available by status",
        "Get pets by their current status",
        "Find all pets with a specific status",
        "Retrieve pets by their status",
        "List pets by status",
        "Show me pets by status",
        "Get a list of pets by status",
        "What is the status of all pets",
        "Find pets by their current status",
        "Return pets by status",
        "Pets by status please",
        "How can I find pets by status",
        "Status of all pets",
        "Pet status search"
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
        "What pets have a certain tag",
        "Search for pets by tag",
        "Get pets with specific tags",
        "Find pets tagged with",
        "Retrieve pets by tag",
        "List pets by tag",
        "Show me pets with a certain tag",
        "Get a list of pets by tag",
        "What tags do pets have",
        "Find pets by their tags",
        "Return pets by tag",
        "Pets by tag please",
        "How can I find pets by tag",
        "Tag search for pets",
        "Search pets by multiple tags"
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
        "What pet has this id",
        "Get pet details by id",
        "Find a pet by its id",
        "Retrieve a pet by id",
        "Show me a pet by id",
        "Get a pet by its id",
        "Pet details by id",
        "What is the pet with this id",
        "Find pet by id number",
        "Return a pet by id",
        "Pet id search",
        "How can I find a pet by id",
        "Id search for pets",
        "Get pet info by id",
        "Find a specific pet by id"
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
        "What is the current pet inventory",
        "Get the pet inventory",
        "Show me the pet inventory",
        "What pets are in stock",
        "Retrieve the pet inventory",
        "List the pet inventory",
        "Get the current inventory of pets",
        "What is the inventory of pets",
        "Find the pet inventory",
        "Return the pet inventory",
        "Pet inventory please",
        "How can I get the pet inventory",
        "Current pet inventory",
        "Pet stock levels",
        "Check pet inventory"
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
        "What order has this id",
        "Get order details by id",
        "Find an order by its id",
        "Retrieve an order by id",
        "Show me an order by id",
        "Get an order by its id",
        "Order details by id",
        "What is the order with this id",
        "Find order by id number",
        "Return an order by id",
        "Order id search",
        "How can I find an order by id",
        "Id search for orders",
        "Get order info by id",
        "Find a specific order by id"
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
        "Cancel an order by id",
        "Delete an order by its id",
        "Remove an order by id",
        "Get rid of an order by id",
        "Eliminate an order by id",
        "What happens when I delete an order",
        "How can I delete an order",
        "Delete a purchase order by id",
        "Remove a purchase order by id",
        "Cancel a purchase order by id",
        "Get rid of a purchase order by id",
        "Eliminate a purchase order by id",
        "Order cancellation by id",
        "Delete order by id number",
        "Remove order by id number"
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
        "Change my user details",
        "Update my user info",
        "Modify my user account",
        "Edit my user profile",
        "Alter my user settings",
        "How can I update my user account",
        "Update user info by username",
        "Change user details by username",
        "Modify user account by username",
        "Edit user profile by username",
        "Update my account",
        "Change my account info",
        "Modify my account settings",
        "Update my profile",
        "Edit my account details"
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
        "Delete my user account",
        "Remove my user account",
        "Get rid of my user account",
        "Eliminate my user account",
        "Cancel my user account",
        "How can I delete my user account",
        "Delete user account by username",
        "Remove user account by username",
        "Eliminate user account by username",
        "Cancel user account by username",
        "Delete my account",
        "Remove my account",
        "Get rid of my account",
        "Eliminate my account",
        "Cancel my account"
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
        "Make a new user account",
        "Create a new user",
        "Add a new user account",
        "Set up a new user account",
        "Create a new user profile",
        "How can I create a new user account",
        "Create user account by username",
        "Add user account by username",
        "Set up user account by username",
        "Create new user info",
        "Make a new account",
        "Create a new profile",
        "Add a new account",
        "Set up a new profile",
        "Create new user details"
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
