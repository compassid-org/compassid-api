#!/bin/bash

# Run all migrations in order
for file in src/migrations/*.sql; do
  echo "Running: $file"
  PGPASSWORD="DevPass2024!Temp" /opt/homebrew/Cellar/postgresql@15/15.14/bin/psql -h localhost -U desertmountain -d compassid -f "$file"
  if [ $? -eq 0 ]; then
    echo "✓ Success"
  else
    echo "✗ Failed"
    exit 1
  fi
  echo ""
done

echo "All migrations completed successfully!"
