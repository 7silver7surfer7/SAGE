# Sage Tooling

These are utilities needed to operate on the Sage data layer. 

## Dependencies

To use, you will need an nft.storage api key. Ask for mine or feel free to create your own if you prefer! 
Once you have an api key, paste it into the first line of a file named keys.txt in the same directory as
totem.js.
You will also need an accessKeyId and secretAccessKey from IAM in AWS. Store those values inside a file named awsConfig.json in the root directory, with the structure:
```
{
    "accessKeyId": "",
    "secretAccessKey": "",
    "region": "us-east-1"
}


You will also want to do ```npm install``` to install the dependencies in the package.json.

## totem.js

totem.js takes in the path to an artist's drop directory, creates a .CAR, uploads the directory to nft.storage,
and creates a drop representing the results, named someCid.json under a drops directory. The artist's drop directory 
should be in the format shown in the dtoc-art directory which has been included as an example.

Metadata about the drop, like the artist's name and the name of their drop, gets pulled from the metadata.json. 

## drops

In drops/ are files that contain information about a drop that is being added to our data layer. 
Each of those files contains links to the images, as well as metadata and a link to the metadata file. 

Each drop file is named {CID}.json, where the CID value is the CID we get back from nft.storage when uploading
the directory.

Example:

```node totem.js dtoc-art```

## crumbler.js

You can use crumbler.js to create drops.json. drops.json is an array of drop objects. The idea
is to make this file available to the UI code, either at app-load or via an endpoint from another service, so that it
can use the data to load images and display drop metadata.

To create drops.json: 

```node crumbler.js crumbs```

To delete the contents of drops/ and to delete the drops.json:

```node crumbler.js clean```

## megazord.js

If you have a directory of drops and you want to process them via a single command, you can run:

```node megazord.js pathToDirectoryOfDirectories```

This will run crumbler to delete any artifacts from the previous run, then it will run totem.js on each of the folders in your directory.
And finally, it will use crumbler to create drops.json.

Later iterations will also create a lottery per drop and assign a lotteryId to each drop, as well as use databaser.js to save drops.json
to Postgres in Heroku.

## databaser.js

databaser.js is used to write the contents of drops.json to Postgres in Heroku in staging and eventually production. In order for
it to run, you need to configure a .env file in the same directory and assign it two values.

```
DATABASE_URL=""
SHADOW_DATABASE_URL=""
```

These would be Postgres connection strings from Heroku. You can request the connection strings from the team if you need them!

```node databaser.js```

Upon running it you'll see some output in the console letting you know that a connection is being established. If your data was added
successfully, you'll see it outputted in the console as well after a successful query to get back what was saved.

## Changing Lambdas

Ex: Say you make a change to UpdatingBalancePackage. First you need to run the zip command. On Mac, from the same directory as
the index.js file you would run:

```zip -r updatingPackage.zip .```

Then you would update the Lambda from the terminal with:

```aws lambda update-function-code --function-name testing --zip-file fileb://updatingBalancePackage.zip```

After that is done executing, you should be able to run the updated Lambda. For more guidance on how to update and deploy Lambdas,
check out: 

https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html

## Seeding the DB

To seed the database with initial data, you can run the following command:

```npx prisma db seed```