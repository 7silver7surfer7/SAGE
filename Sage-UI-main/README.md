# SAGE UI

## Local Development

1. Clone the repo and `npm install`.
2. Create a .env file for the environment variables. Use the staging database for the staging branch.

## Automated building

Hosted on vercel.

## Testing

## Schema changes

Sometimes the schema in the data model changes. When this happens, you may see build failures or other errors because of schema issues. This is because we are using Prisma which generates a Prisma Client in order to talk to the database. If the schema changes and the Prisma Client is out of date, you will get errors. In order to update the schema, you can run:

`npx prisma db pull --schema=./src/prisma/schema.prisma`

This will inspect the database, provided you've got the correct credentials, and update the Prisma Client so that it reflects the updated models.

read more on prisma [here](https://www.prisma.io/docs/)
