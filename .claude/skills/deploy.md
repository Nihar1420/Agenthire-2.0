# Skill: deploy

Deploy AgentHire to the VPS after a change.

```bash
git pull
npm install
(cd ui && npm install && npm run build)
pm2 restart ecosystem.config.cjs
pm2 save
```

Then confirm all 4 processes are online:

```bash
pm2 status
node limits-check.cjs
```
