/** 选项栏弹出位置的锚点（客户端坐标，单位 CSS px） */
export interface MenuAnchor {
  x: number;
  y: number;
  /**
   * left：x 是菜单左边缘（右键菜单，跟着鼠标走）
   * right：x 是菜单右边缘（三点按钮，菜单贴着按钮右对齐）
   */
  align: 'left' | 'right';
}
