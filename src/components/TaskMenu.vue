<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { TASK_COLORS } from '../theme/colors';
import type { Task, TaskColor } from '../types/task';
import type { MenuAnchor } from '../types/ui';

const props = defineProps<{ task: Task; anchor: MenuAnchor }>();
const emit = defineEmits<{
  close: [];
  color: [color: TaskColor];
  pin: [];
}>();

const panel = ref<HTMLElement | null>(null);
const placed = ref<{ left: number; top: number } | null>(null);

/**
 * 先渲染、再测量、最后夹到窗口内。
 * 菜单宽度随色块数量变化，把数字写死在 min() 里迟早对不上，所以按真实尺寸算。
 */
onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onViewportChange);

  await nextTick();
  const node = panel.value;
  if (!node) return;

  const rect = node.getBoundingClientRect();
  const margin = 8;
  const left = props.anchor.align === 'right' ? props.anchor.x - rect.width : props.anchor.x;
  const maxLeft = window.innerWidth - rect.width - margin;
  const maxTop = window.innerHeight - rect.height - margin;

  placed.value = {
    left: Math.min(Math.max(margin, left), Math.max(margin, maxLeft)),
    top: Math.min(Math.max(margin, props.anchor.y), Math.max(margin, maxTop)),
  };
});

const panelStyle = computed<Record<string, string>>(() => {
  // 测量完成前先藏着，避免在错误位置闪一下
  const base = placed.value ?? { left: props.anchor.x, top: props.anchor.y };
  return {
    left: `${base.left}px`,
    top: `${base.top}px`,
    visibility: placed.value ? 'visible' : 'hidden',
  };
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

function onViewportChange(): void {
  emit('close');
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onViewportChange);
});
</script>

<template>
  <div class="menu-layer" @pointerdown.self="emit('close')" @contextmenu.prevent>
    <div ref="panel" class="menu" :style="panelStyle" role="menu" aria-label="任务选项">
      <p class="menu__label">底色</p>
      <div class="menu__swatches">
        <button
          v-for="tokens in TASK_COLORS"
          :key="tokens.id"
          class="swatch"
          :class="{
            'swatch--active': tokens.id === task.color,
            'swatch--none': tokens.id === 'default',
          }"
          type="button"
          :title="tokens.label"
          :aria-label="tokens.label"
          :style="{ background: tokens.bg, borderColor: tokens.line }"
          @click="emit('color', tokens.id)"
        >
          <span v-if="tokens.id === task.color" class="swatch__tick" :style="{ color: tokens.fg }">
            ✓
          </span>
        </button>
      </div>

      <div class="menu__divider"></div>

      <button class="menu__action" type="button" role="menuitem" @click="emit('pin')">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20V8" />
          <path d="m7 12 5-5 5 5" />
          <path d="M5 4h14" />
        </svg>
        <span>{{ task.pinnedAt ? '取消置顶' : '置顶' }}</span>
      </button>
    </div>
  </div>
</template>
