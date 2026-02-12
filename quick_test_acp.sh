#!/bin/bash

###############################################################################
# OpenCode ACP 快速测试脚本
###############################################################################
#
# 功能: 一键编译 + 运行 ACP 验证
#
# 使用方法:
#   chmod +x quick_test_acp.sh
#   ./quick_test_acp.sh
#
###############################################################################

set -e  # 遇到错误立即退出

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           OpenCode ACP 快速测试脚本                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 步骤 1: 检查环境
echo -e "${BLUE}[1/4]${NC} 检查环境..."

if ! command -v bun &> /dev/null; then
    echo -e "${RED}错误: 未找到 Bun 运行时${NC}"
    echo "请安装 Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js${NC}"
    echo "请安装 Node.js: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✓${NC} Bun 版本: $(bun --version)"
echo -e "${GREEN}✓${NC} Node 版本: $(node --version)"
echo ""

# 步骤 2: 安装依赖
echo -e "${BLUE}[2/4]${NC} 检查依赖..."

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}依赖未安装,开始安装...${NC}"
    bun install
else
    echo -e "${GREEN}✓${NC} 依赖已安装"
fi
echo ""

# 步骤 3: 编译 OpenCode
echo -e "${BLUE}[3/4]${NC} 编译 OpenCode..."

DIST_FILE="packages/opencode/dist/index.js"

if [ ! -f "$DIST_FILE" ]; then
    echo -e "${YELLOW}编译文件不存在,开始编译...${NC}"
    bun run build
else
    echo -e "${YELLOW}检测到编译文件,是否重新编译? (y/N)${NC}"
    read -t 5 -n 1 rebuild || rebuild="n"
    echo ""

    if [[ $rebuild =~ ^[Yy]$ ]]; then
        echo "重新编译..."
        bun run build
    else
        echo -e "${GREEN}✓${NC} 使用现有编译文件"
    fi
fi
echo ""

# 步骤 4: 运行测试
echo -e "${BLUE}[4/4]${NC} 运行 ACP 验证脚本..."
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""

node verify_acp.js

# 检查退出状态
if [ $? -eq 0 ]; then
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo -e "${GREEN}✓ 测试成功完成!${NC}"
    echo ""

    # 显示生成的文件
    if [ -d "mock_project/src" ]; then
        echo -e "${BLUE}生成的文件:${NC}"
        ls -lah mock_project/src/
    fi
else
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo -e "${RED}✗ 测试失败${NC}"
    echo ""
    exit 1
fi
