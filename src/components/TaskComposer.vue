<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ quick?: boolean }>();

const emit = defineEmits<{ submit: [payload: { title: string; dueAt: string }] }>();

const title = ref('');
const due = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

function submit(): void {
  const value = title.value.trim();
  if (!value) return;
  emit('submit', { title: value, dueAt: due.value });
  title.value = '';
  due.value = '';
}

/** 被全局快捷键叫出来时，把焦点丢进输入框 */
function focusTitle(): void {
  titleInput.value?.focus();
  titleInput.value?.select();
}

defineExpose({ focusTitle });
</script>

<template>
  <form class="composer" :class="{ 'composer--quick': props.quick }" @submit.prevent="submit">
    <span class="composer__plus" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
    <input
      ref="titleInput"
      v-model="title"
      class="composer__title"
      type="text"
      :placeholder="props.quick ? '记一笔，回车添加并收回托盘' : '要做什么？回车添加'"
      maxlength="120"
      autocomplete="off"
      autofocus
      @keydown.enter.prevent="submit"
    />
    <input v-model="due" class="composer__due" type="datetime-local" title="截止时间（可选）" />
    <button class="composer__submit" type="submit" :disabled="!title.trim()">添加</button>
  </form>
</template>
