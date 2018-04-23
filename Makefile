help:
	@echo "container - builds development/testing container"
	@echo "run - runs ganache inside container"
	@echo "deploy - deploys contracts inside container"
	@echo "test-container - build container and deploys artifacts

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

run:
	docker run -it -p 8545:8545 --name platform-contracts --rm neufund/platform-contracts yarn testrpc

deploy:
	docker exec platform-contracts yarn deploy localhost
