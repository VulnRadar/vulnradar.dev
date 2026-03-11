#!/bin/bash

# Delete deprecated v1 API routes
rm -rf /vercel/share/v0-project/app/api/v1

echo "Deleted /api/v1 routes directory"
