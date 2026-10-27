#!/usr/bin/env bash
set -euo pipefail
# Credentials and paths exist only in the disposable network created by run.py.
/opt/jboss/wildfly/bin/add-user.sh -a -u acceptance -p disposable-acceptance-only -g GRP_SYMPHONY -s
/opt/jboss/wildfly/bin/add-user.sh -a -u stranger -p disposable-acceptance-only -g GRP_SYMPHONY -s
# The CLI checks each existing resource so retained containers can be restarted.
/opt/jboss/wildfly/bin/jboss-cli.sh --file=/verification/configure.cli
cp /verification/deployment.war /opt/jboss/wildfly/standalone/deployments/symphony-ws.war
exec /opt/jboss/wildfly/bin/standalone.sh -c standalone-full.xml -b 0.0.0.0
