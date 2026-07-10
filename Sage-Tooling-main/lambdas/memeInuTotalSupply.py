import json
import boto3

def lambda_handler(event, context):
    try: 
        db = boto3.resource('dynamodb')
        table = db.Table('memex-token-total-supplies')
        response = table.get_item(
            Key = {
                'tokenName': 'memeInu'
            }
        )
        
        return response['Item']['totalSupply']
        return {
            'statusCode': 200,
            'body': json.dumps(response['Item']['totalSupply'])
        }

    except Exception as e:
        # TODO: log exception so we can see what happened
        # return the last known good hardcoded value 
        return {
            'statusCode': 200,
            'body': 1065822299.31
        }
        
