help:
	@echo "dev - makes dev environment with yarn"
	@echo "container - builds development/testing container"
	@echo "run - runs ganache inside container"
	@echo "deploy - deploys contracts inside container"
	@echo "test-container - build container and deploys artifacts

dev:
	yarn

run:
	docker run -it -p 8545:8545 --name platform-contracts --rm neufund/platform-contracts yarn testrpc

deploy:
	docker exec platform-contracts yarn deploy localhost

test-container: container
	docker run --detach -it -p 8545:8545 --name platform-contracts --rm neufund/platform-contracts yarn testrpc
	sleep 5
	$(MAKE) deploy
	$(MAKE) down

down:
ifneq ($(shell docker ps -f NAME=platform-contracts -q),)
	docker stop platform-contracts
endif

container: down
	docker build . -t neufund/platform-contracts

update-artifacts:
	-kill $(shell lsof -t -i:8545)
	$(eval ganachepid = $(shell yarn testrpc > /dev/null &  echo "$$!"))
	sleep 5
	yarn build
	yarn deploy localhost
	kill $(ganachepid)
	$(eval commitid = $(shell git rev-parse HEAD))
	echo $(commitid)
	cd platform-contracts-artifacts && git remote set-url origin git@github.com:Neufund/platform-contracts-artifacts.git && git add -A && git commit -m "from platform-contracts "$(commitid) && git push origin master
