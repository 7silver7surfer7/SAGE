#!/bin/ksh
SCRIPTDIR=$(cd $(dirname $0);echo $PWD)
pid=$SCRIPTDIR"/update_balances.pid"
trap "rm -f $pid" SIGSEGV
trap "rm -f $pid" SIGINT

if [ -e $pid ]; then
    echo "script is already running"
    exit # pid file exists, another instance is running, so now we politely exit
else
    echo $$ > $pid # pid file doesn't exit, create one and go on
fi


cd $SCRIPTDIR; cd ../..
git pull
case "$SCRIPTDIR" in
  *dev*)     export HARDHAT_NETWORK=dev ;;
  *staging*) export HARDHAT_NETWORK=fantomtestnet ;;
  *)         export HARDHAT_NETWORK=fantom ;;
esac
/home/ubuntu/.nvm/versions/node/v16.13.0/bin/node scripts/update_balances.js 1

rm -f $pid # remove pid file just before exiting
exit