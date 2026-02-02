.PHONY: help install dev build clean release version-bump check

# Default target
.DEFAULT_GOAL := help

# Project configuration
ROOT_DIR := $(shell pwd)
CURRENT_VERSION := $(shell node -p "require('./package.json').version")

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)S3 Image Uploader - Make Commands$(NC)"
	@echo "$(YELLOW)Current version: $(CURRENT_VERSION)$(NC)"
	@echo ""
	@echo "$(GREEN)Development Commands:$(NC)"
	@echo "  make install         - Install dependencies"
	@echo "  make dev             - Start development build (watch mode)"
	@echo "  make build           - Production build"
	@echo "  make clean           - Clean build artifacts"
	@echo ""
	@echo "$(GREEN)Release Commands:$(NC)"
	@echo "  make version-bump    - Bump version (pass V=patch|minor|major)"
	@echo "  make release         - Build, tag, and create GitHub release"
	@echo "  make check           - Show current version and git status"
	@echo ""

# =============================================================================
# Development Commands
# =============================================================================

install: ## Install dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	@npm install
	@echo "$(GREEN)Done$(NC)"

dev: ## Start development build (watch mode)
	@echo "$(BLUE)Starting dev build (watch mode)...$(NC)"
	@npm run dev

build: ## Production build
	@echo "$(BLUE)Building for production...$(NC)"
	@npm run build
	@echo "$(GREEN)Build complete$(NC)"

clean: ## Clean build artifacts
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	@rm -rf node_modules/.cache
	@rm -f main.js
	@echo "$(GREEN)Clean complete$(NC)"

# =============================================================================
# Release Commands
# =============================================================================

check: ## Show current version and git status
	@echo "$(BLUE)S3 Image Uploader Status$(NC)"
	@echo ""
	@echo "  Version:  $(CURRENT_VERSION)"
	@echo "  Branch:   $$(git branch --show-current)"
	@echo "  Latest tag: $$(git describe --tags --abbrev=0 2>/dev/null || echo 'none')"
	@echo ""
	@echo "$(BLUE)Git Status:$(NC)"
	@git status --short || true

version-bump: ## Bump version (V=patch|minor|major, default: patch)
	@echo "$(BLUE)Bumping version ($(or $(V),patch))...$(NC)"
	@npm version $(or $(V),patch) --no-git-tag-version
	@node version-bump.mjs
	@git add package.json package-lock.json manifest.json versions.json
	@echo "$(GREEN)Version bumped to $$(node -p "require('./package.json').version")$(NC)"

release: build ## Build, tag, and create GitHub release
	@echo "$(BLUE)Creating release...$(NC)"
	@if ! command -v gh &> /dev/null; then \
		echo "$(RED)GitHub CLI not found. Install from https://cli.github.com/$(NC)"; \
		exit 1; \
	fi
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "$(RED)Working directory not clean. Commit or stash changes first.$(NC)"; \
		exit 1; \
	fi
	$(eval VERSION := $(shell node -p "require('./package.json').version"))
	$(eval TAG := $(VERSION))
	$(eval REPO := $(shell git remote get-url origin | sed -e 's/^https:\/\/github.com\///' -e 's/\.git$$//'))
	@git tag -a $(TAG) -m "$(TAG)"
	@git push --tags
	@gh release create "$(TAG)" \
		--repo "$(REPO)" \
		--title "$(TAG)" \
		--notes "Release $(TAG)"
	@for file in main.js styles.css manifest.json; do \
		gh release upload "$(TAG)" "$$file" --repo "$(REPO)" && \
		echo "$(GREEN)Uploaded $$file$(NC)" || \
		{ echo "$(RED)Failed to upload $$file$(NC)"; exit 3; }; \
	done
	@echo ""
	@echo "$(GREEN)Release $(TAG) created and assets uploaded$(NC)"
