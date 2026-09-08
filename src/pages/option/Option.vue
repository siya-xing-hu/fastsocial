<template>
  <div class="flex min-h-screen bg-gray-50">
    <!-- 左侧导航 - 添加固定宽度和阴影 -->
    <aside
      class="fixed w-[200px] h-full bg-white shadow-sm border-r border-gray-200"
    >
      <div class="py-6 px-3">
        <h1 class="text-xl font-medium px-3 mb-6">设置</h1>
        <div
          v-for="item in menuItems"
          :key="item.key"
          :class="[
            'px-3 py-2 mb-1 rounded-md cursor-pointer text-gray-600 hover:bg-gray-100',
            currentMenu === item.key ? 'bg-gray-100 text-gray-900' : '',
          ]"
          @click="currentMenu = item.key"
        >
          {{ item.label }}
        </div>
      </div>
    </aside>

    <!-- 右侧配置区域 -->
    <main class="flex-1 ml-[200px] p-8">
      <!-- 基础配置 -->
      <section v-if="currentMenu === 'basic'" class="max-w-4xl">
        <div class="mb-8">
          <h2 class="text-3xl font-bold text-gray-900 mb-2">基础配置</h2>
          <p class="text-gray-600">配置应用的基础设置和默认选项</p>
        </div>

        <div class="space-y-6">
          <div
            class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            <div class="p-6">
              <h3 class="text-xl font-semibold text-gray-800 mb-6">基础设置</h3>

              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2"
                      >默认AI服务</label
                    >
                    <select
                      v-model="config.basic.aiProvider"
                      class="form-input"
                    >
                      <option
                        v-for="option in serviceModelOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2"
                      >翻译服务</label
                    >
                    <select
                      v-model="config.basic.translateProvider"
                      class="form-input"
                    >
                      <option value="google">Google</option>
                      <option value="ai">AI</option>
                      <option value="deepl">DeepL</option>
                    </select>
                  </div>
                </div>

                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2"
                      >目标语言</label
                    >
                    <select
                      v-model="config.basic.targetLang"
                      class="form-input"
                    >
                      <option value="zh-CN">中文</option>
                      <option value="en">英文</option>
                    </select>
                  </div>

                  <div class="flex items-center justify-between py-2">
                    <label class="text-sm font-medium text-gray-700"
                      >自动翻译</label
                    >
                    <label
                      class="relative inline-flex items-center cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        v-model="config.basic.autoTranslate"
                        class="sr-only peer"
                      />
                      <div
                        class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                      ></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- AI 服务配置 -->
      <section v-if="currentMenu === 'ai'" class="max-w-4xl">
        <div class="mb-8">
          <h2 class="text-3xl font-bold text-gray-900 mb-2">AI服务配置</h2>
          <p class="text-gray-600">管理和配置您的AI服务提供商</p>
        </div>

        <!-- 服务列表 -->
        <div class="space-y-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-800">已配置的服务</h3>
            <button
              @click="addEmptyService"
              :disabled="isAddingService"
              class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              添加服务
            </button>
          </div>

          <div class="space-y-6">
            <div
              v-for="service in config.aiServices"
              :key="service.id"
              :data-service-id="service.id"
              class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div class="p-6">
                <!-- 服务头部 -->
                <div class="flex items-center justify-between mb-6">
                  <div class="flex items-center space-x-3">
                    <div
                      class="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div>
                      <input
                        v-if="service.id === newServiceId"
                        type="text"
                        v-model="service.name"
                        class="text-lg font-semibold text-gray-900 bg-transparent border-b border-gray-300 focus:border-blue-500 focus:outline-none"
                        placeholder="请输入服务名称"
                        @input="updateService(service)"
                      />
                      <h3 v-else class="text-lg font-semibold text-gray-900">
                        {{ service.name }}
                      </h3>
                      <p class="text-sm text-gray-500">AI服务提供商</p>
                    </div>
                  </div>
                  <div class="flex items-center space-x-3">
                    <label
                      class="relative inline-flex items-center cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        v-model="service.enabled"
                        class="sr-only peer"
                      />
                      <div
                        class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                      ></div>
                    </label>
                    <button
                      @click="removeService(service)"
                      class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- 服务配置 -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div class="space-y-4">
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-2"
                        >服务地址</label
                      >
                      <div class="relative">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <input
                          v-model="service.endpoint"
                          type="text"
                          class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          placeholder="输入服务地址"
                          @input="updateService(service)"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-2"
                        >API Key</label
                      >
                      <div class="relative">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                          />
                        </svg>
                        <input
                          type="password"
                          :value="getServiceApiKey(service.id)"
                          @input="(e: Event) => setServiceApiKey(service.id, (e.target as HTMLInputElement).value)"
                          class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          placeholder="输入API密钥"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- 模型列表 -->
                  <div class="space-y-4">
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-2"
                        >模型列表</label
                      >
                      <div class="space-y-2">
                        <button
                          @click="openAddModelDialog(service)"
                          class="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 text-center text-gray-600 hover:text-blue-600"
                        >
                          <div class="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              class="h-5 w-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                              />
                            </svg>
                            <span class="font-medium">添加新模型</span>
                          </div>
                        </button>

                        <!-- 模型标签 -->
                        <div class="flex flex-wrap gap-2">
                          <div
                            v-for="model in service.customModels"
                            :key="model.name"
                            class="flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-gray-100 transition-colors"
                            :class="[
                              getSelectedProviderModel().model === model.name &&
                              getSelectedProviderModel().serviceId ===
                                service.id
                                ? 'bg-blue-50'
                                : 'bg-gray-50',
                            ]"
                            @click="selectServiceModel(service.id, model.name)"
                          >
                            <span class="text-sm font-medium">{{
                              model.name
                            }}</span>
                            <button
                              @click.stop="openEditModelDialog(service, model)"
                              class="text-gray-500 hover:text-blue-600 transition-colors p-1"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-3 w-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            <button
                              @click.stop="removeModel(service, model.name)"
                              class="text-gray-500 hover:text-red-600 transition-colors p-1"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-3 w-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 翻译服务配置 -->
      <section v-if="currentMenu === 'translate'" class="max-w-4xl">
        <div class="mb-8">
          <h2 class="text-3xl font-bold text-gray-900 mb-2">翻译服务配置</h2>
          <p class="text-gray-600">配置翻译服务的相关设置和API密钥</p>
        </div>

        <div class="space-y-6">
          <!-- 翻译 Prompt 配置 -->
          <div
            class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            <div class="p-6">
              <h3 class="text-xl font-semibold text-gray-800 mb-6">
                翻译提示词配置
              </h3>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >翻译提示词</label
                  >
                  <textarea
                    v-model="config.translationService.translatePrompt"
                    class="form-input min-h-[120px]"
                    placeholder="请输入翻译提示词，可以使用 {targetLang} 变量表示目标语言"
                  ></textarea>
                  <p class="mt-2 text-sm text-gray-500">
                    提示：可以使用 {targetLang} 变量来表示目标语言
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- DeepL 配置 -->
          <div
            class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            <div class="p-6">
              <h3 class="text-xl font-semibold text-gray-800 mb-6">
                DeepL 配置
              </h3>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >API Key</label
                  >
                  <input
                    type="password"
                    :value="getDeeplApiKey()"
                    @input="(e: Event) => setDeeplApiKey((e.target as HTMLInputElement).value)"
                    class="form-input"
                    placeholder="请输入DeepL API密钥"
                  />
                  <p class="mt-2 text-sm text-gray-500">
                    在
                    <a
                      href="https://www.deepl.com/pro-api"
                      target="_blank"
                      class="text-blue-600 hover:underline"
                      >DeepL API</a
                    >
                    获取你的 API Key
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Prompt 列表部分 -->
      <section v-if="currentMenu === 'prompts'" class="max-w-4xl">
        <div class="mb-8">
          <h2 class="text-3xl font-bold text-gray-900 mb-2">Prompt 列表</h2>
          <p class="text-gray-600">管理和配置您的自定义提示词模板</p>
        </div>

        <!-- 场景切换标签 -->
        <div class="mb-6">
          <div class="border-b border-gray-200">
            <nav class="flex -mb-px">
              <button
                v-for="scene in promptScenes"
                :key="scene"
                @click="currentPromptScene = scene"
                class="py-4 px-6 font-medium text-sm border-b-2 whitespace-nowrap"
                :class="[
                  currentPromptScene === scene
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                ]"
              >
                {{ getSceneLabel(scene) }}
              </button>
            </nav>
          </div>
        </div>

        <!-- 当前场景说明 -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg
                class="h-5 w-5 text-blue-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-blue-800">
                {{ getSceneLabel(currentPromptScene) }}说明
              </h3>
              <div class="mt-2 text-sm text-blue-700">
                <p v-if="currentPromptScene === 'post'">
                  结合用户输入的内容生成结果。可以使用 {userContent}
                  变量来表示用户输入的内容。
                </p>
                <p v-else-if="currentPromptScene === 'reply'">
                  根据想要回复的内容结合用户输入的内容生成结果。可以使用
                  {replyContent} 变量来表示想要回复的内容，{userContent}
                  变量来表示用户输入的内容。
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 按钮列表 -->
        <div class="space-y-6">
          <div
            v-for="prompt in config.prompts[currentPromptScene]"
            :key="prompt.id"
            :data-prompt-id="prompt.id"
            class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            <div class="p-6">
              <div class="flex justify-between items-start mb-6">
                <div class="flex items-center gap-3">
                  <div
                    class="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center"
                  >
                    <span class="text-white text-lg">{{ prompt.icon }}</span>
                  </div>
                  <div>
                    <input
                      v-if="prompt.id === newPromptId"
                      type="text"
                      v-model="prompt.name"
                      class="text-lg font-semibold text-gray-900 bg-transparent border-b border-gray-300 focus:border-blue-500 focus:outline-none"
                      placeholder="请输入按钮名称"
                      @input="updatePrompt(prompt)"
                    />
                    <h4 v-else class="text-lg font-semibold text-gray-900">
                      {{ prompt.name }}
                    </h4>
                    <p class="text-sm text-gray-500">自定义提示词</p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <label
                    class="relative inline-flex items-center cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      v-model="prompt.enabled"
                      class="sr-only peer"
                    />
                    <div
                      class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                    ></div>
                  </label>
                  <button
                    @click="removePrompt(prompt)"
                    class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- 按钮配置表单 -->
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2"
                      >按钮名称</label
                    >
                    <input
                      type="text"
                      v-model="prompt.name"
                      class="form-input"
                      placeholder="请输入按钮名称"
                      @input="updatePrompt(prompt)"
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2"
                      >按钮图标</label
                    >
                    <select
                      v-model="prompt.icon"
                      class="form-input"
                      @change="updatePrompt(prompt)"
                    >
                      <option
                        v-for="icon in iconOptions"
                        :key="icon.value"
                        :value="icon.value"
                      >
                        {{ icon.label }}
                      </option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >提示词</label
                  >
                  <textarea
                    v-model="prompt.prompt"
                    class="form-input min-h-[120px]"
                    placeholder="请输入提示词"
                    @input="updatePrompt(prompt)"
                  ></textarea>
                </div>
              </div>
            </div>
          </div>

          <!-- 添加按钮按钮 -->
          <button
            @click="() => addEmptyPrompt(currentPromptScene)"
            :disabled="isAddingPrompt"
            class="w-full py-6 flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-100 transition-colors text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div class="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              <span class="font-medium">添加新提示词</span>
            </div>
          </button>
        </div>
      </section>

      <!-- 删除确认对话框 -->
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      >
        <div class="bg-white rounded-lg p-6 w-[400px]">
          <h3 class="text-lg font-medium mb-4">
            确认删除{{ itemToDelete?.type === "service" ? "服务" : "按钮" }}
          </h3>
          <p class="text-gray-600 mb-6">
            确定要删除{{
              itemToDelete?.type === "service" ? "服务" : "按钮"
            }}
            "{{ itemToDelete?.item.name }}" 吗？此操作不可恢复。
          </p>
          <div class="flex justify-end gap-2">
            <button
              @click="showDeleteConfirm = false"
              class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            >
              取消
            </button>
            <button
              @click="confirmDelete"
              class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- 模型编辑弹框 -->
      <div
        v-if="showModelDialog"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      >
        <div
          class="bg-white rounded-lg p-6 w-[500px] max-h-[80vh] overflow-y-auto"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-lg font-medium">
              {{ isEditingModel ? "编辑模型" : "添加模型" }}
            </h3>
            <button
              @click="closeModelDialog"
              class="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >模型名称</label
              >
              <input
                v-model="editingModel.name"
                type="text"
                class="form-input"
                placeholder="请输入模型名称"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >思考模式</label
              >
              <div class="space-y-3">
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      v-model="editingModel.thinkingEnabled"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="text-sm">启用思考模式</span>
                  </label>
                </div>

                <div v-if="editingModel.thinkingEnabled" class="ml-6">
                  <label class="block text-sm font-medium text-gray-600 mb-2"
                    >思考模式类型</label
                  >
                  <select
                    v-model="editingModel.thinkingType"
                    class="form-input"
                  >
                    <option value="enabled">启用</option>
                    <option value="disabled">禁用</option>
                    <option value="auto">自动</option>
                  </select>
                  <p class="mt-1 text-sm text-gray-500">
                    选择具体的思考模式配置
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <button
              @click="closeModelDialog"
              class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            >
              取消
            </button>
            <button
              @click="saveModel"
              :disabled="!editingModel.name.trim()"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      <!-- 保存按钮 -->
      <div class="fixed bottom-8 right-8">
        <button
          @click="saveConfiguration"
          class="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all transform active:scale-95"
        >
          保存配置
        </button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { log_error } from "../../common/logging";
import {
  IconEnum,
  PromptScenes,
  config,
  getDeeplApiKey,
  getServiceApiKey,
  initConfig,
  onInput,
  promptScenes,
  setDeeplApiKey,
  setServiceApiKey,
  type AIServiceConfig,
  type PromptConfig
} from "../../common/storage-config";

// 使用 computed 优化菜单项
const menuItems = computed(() => [
  { key: "basic", label: "基础配置" },
  { key: "ai", label: "AI 服务" },
  { key: "translate", label: "翻译服务" },
  { key: "prompts", label: "Prompt 列表" },
]);

const currentMenu = ref("basic");
const currentPromptScene = ref<PromptScenes>("post"); // 更精确的类型
const newServiceId = ref<string | null>(null);
const isAddingService = ref(false);
const newPromptId = ref<string | null>(null);
const isAddingPrompt = ref(false);
const showDeleteConfirm = ref(false);
const itemToDelete = ref<{
  type: "service" | "prompt";
  item: any;
  scene?: PromptScenes;
} | null>(null);

// 模型弹框相关
const showModelDialog = ref(false);
const isEditingModel = ref(false);
const editingModel = ref<{
  name: string;
  thinkingType: string;
  thinkingEnabled: boolean;
}>({ name: "", thinkingType: "auto", thinkingEnabled: false });
const currentEditingService = ref<AIServiceConfig | null>(null);

// 获取所有按钮图标选项
const iconOptions = computed(() => {
  // 过滤掉数字索引，只保留实际的图标值
  return Object.values(IconEnum)
    .filter((value) => typeof value === "string")
    .map((icon) => ({
      value: icon,
      label: icon,
    }));
});

// 处理选中的服务和模型
interface SelectedProviderModel {
  serviceId: string;
  model: string;
}

// 获取当前选择的服务和模型
const getSelectedProviderModel = () => {
  const [serviceId = "", model = ""] = config.value.basic.aiProvider.split(":");
  return { serviceId, model } as SelectedProviderModel;
};

// 选择服务和模型
const selectServiceModel = (serviceId: string, model: string) => {
  config.value.basic.aiProvider = `${serviceId}:${model}`;
  onInput();
};

// 直接在列表添加空服务
const addEmptyService = () => {
  if (isAddingService.value) return;

  isAddingService.value = true;
  const id = `custom-${Date.now()}`;
  newServiceId.value = id;

  const service: AIServiceConfig = {
    id: id,
    name: "",
    endpoint: "",
    customModels: [],
    enabled: true,
  };

  config.value.aiServices.push(service);

  // 初始设置API密钥为空
  setServiceApiKey(id, "");

  // 设置焦点到新添加的服务（可选）
  setTimeout(() => {
    const newServiceElement = document.querySelector(
      `[data-service-id="${id}"] input`
    );
    if (newServiceElement) {
      (newServiceElement as HTMLInputElement).focus();
    }
  }, 100);
};

// 直接添加空按钮
const addEmptyPrompt = (scene: PromptScenes) => {
  if (isAddingPrompt.value) return;

  isAddingPrompt.value = true;
  const id = `${scene}-${Date.now()}`;
  newPromptId.value = id;

  const prompt: PromptConfig = {
    id: id,
    name: "",
    icon: "✨",
    prompt: "",
    enabled: true,
  };

  config.value.prompts[scene].push(prompt);

  // 设置焦点到新添加的按钮（可选）
  setTimeout(() => {
    const newPromptElement = document.querySelector(
      `[data-prompt-id="${id}"] input`
    );
    if (newPromptElement) {
      (newPromptElement as HTMLInputElement).focus();
    }
  }, 100);
};

// 优化移除服务方法
const removeService = (service: AIServiceConfig) => {
  itemToDelete.value = { type: "service", item: service };
  showDeleteConfirm.value = true;
};

// 移除按钮方法
const removePrompt = (prompt: PromptConfig) => {
  // 找出按钮所在的场景
  let scene: PromptScenes | undefined;
  for (const s of promptScenes) {
    if (config.value.prompts[s].some((b) => b.id === prompt.id)) {
      scene = s;
      break;
    }
  }

  if (!scene) return;

  itemToDelete.value = {
    type: "prompt",
    item: prompt,
    scene,
  };
  showDeleteConfirm.value = true;
};

// 确认删除
const confirmDelete = () => {
  if (!itemToDelete.value) return;

  if (itemToDelete.value.type === "service") {
    const service = itemToDelete.value.item as AIServiceConfig;
    const index = config.value.aiServices.findIndex((s) => s.id === service.id);
    if (index > -1) {
      // 如果删除的是当前选中的服务，切换到第一个可用的服务
      const selected = getSelectedProviderModel();
      if (selected.serviceId === service.id) {
        const firstEnabled = config.value.aiServices.find(
          (s) => s.enabled && s.id !== service.id
        );
        if (
          firstEnabled &&
          firstEnabled.customModels &&
          firstEnabled.customModels.length > 0
        ) {
          selectServiceModel(
            firstEnabled.id,
            firstEnabled.customModels[0].name
          );
        }
      }
      config.value.aiServices.splice(index, 1);
    }

    // 重置添加状态，以防删除的是正在添加的服务
    if (service.id === newServiceId.value) {
      isAddingService.value = false;
      newServiceId.value = null;
    }
  } else if (itemToDelete.value.type === "prompt") {
    const prompt = itemToDelete.value.item as PromptConfig;
    const scene = itemToDelete.value.scene as PromptScenes | undefined;

    if (scene) {
      const index = config.value.prompts[scene].findIndex(
        (b) => b.id === prompt.id
      );

      if (index > -1) {
        config.value.prompts[scene].splice(index, 1);
      }

      // 重置添加状态，以防删除的是正在添加的按钮
      if (prompt.id === newPromptId.value) {
        isAddingPrompt.value = false;
        newPromptId.value = null;
      }
    }
  }

  showDeleteConfirm.value = false;
  itemToDelete.value = null;
};

// 删除模型
const removeModel = (service: AIServiceConfig, modelName: string) => {
  if (!service.customModels) return;

  const index = service.customModels.findIndex((m) => m.name === modelName);
  if (index > -1) {
    service.customModels.splice(index, 1);

    // 检查当前选择的是否是被删除的模型
    const selected = getSelectedProviderModel();
    if (
      selected.serviceId === service.id &&
      selected.model === modelName &&
      service.customModels.length > 0
    ) {
      // 如果是，选择第一个可用模型
      selectServiceModel(service.id, service.customModels[0].name);
    }
  }
};

// 添加新的方法：更新服务配置
const updateService = (service: AIServiceConfig) => {
  const index = config.value.aiServices.findIndex((s) => s.id === service.id);
  if (index !== -1) {
    // 直接替换整个服务对象，确保customModels数组被正确更新
    config.value.aiServices[index] = service;
    // 触发配置更新
    onInput();
  }
};

// 更新按钮配置
const updatePrompt = (prompt: PromptConfig) => {
  for (const scene of promptScenes) {
    const index = config.value.prompts[scene].findIndex(
      (b) => b.id === prompt.id
    );
    if (index !== -1) {
      config.value.prompts[scene][index] = { ...prompt };
      break;
    }
  }
};

// 优化保存配置方法
const saveConfiguration = async () => {
  try {
    onInput();
    // 可以添加保存成功的提示
  } catch (error) {
    log_error("保存配置失败:", error);
    // 可以添加保存失败的提示
  }
};

// 计算所有可用的服务-模型组合
const serviceModelOptions = computed(() => {
  const options = [];
  for (const service of config.value.aiServices) {
    if (
      service.enabled &&
      service.customModels &&
      service.customModels.length > 0
    ) {
      for (const model of service.customModels) {
        options.push({
          value: `${service.id}:${model.name}`,
          label: `${service.name}:${model.name}`,
        });
      }
    }
  }
  return options;
});

// 获取场景的中文名称
function getSceneLabel(scene: string): string {
  switch (scene) {
    case "post":
      return "生成场景";
    case "reply":
      return "回复场景";
    default:
      return String(scene);
  }
}

// 模型弹框相关方法
const openAddModelDialog = (service: AIServiceConfig) => {
  currentEditingService.value = service;
  isEditingModel.value = false;
  editingModel.value = {
    name: "",
    thinkingType: "auto",
    thinkingEnabled: false,
  };
  showModelDialog.value = true;
};

const openEditModelDialog = (service: AIServiceConfig, model: any) => {
  currentEditingService.value = service;
  isEditingModel.value = true;
  editingModel.value = {
    name: model.name,
    thinkingType: model.thinking?.type || "auto",
    thinkingEnabled: !!model.thinking,
  };
  showModelDialog.value = true;
};

const closeModelDialog = () => {
  showModelDialog.value = false;
  currentEditingService.value = null;
  editingModel.value = {
    name: "",
    thinkingType: "auto",
    thinkingEnabled: false,
  };
};

const saveModel = () => {
  if (!currentEditingService.value || !editingModel.value.name.trim()) return;

  if (!currentEditingService.value.customModels) {
    currentEditingService.value.customModels = [];
  }

  const modelName = editingModel.value.name.trim();

  // 查找现有模型
  const existingModelIndex = currentEditingService.value.customModels.findIndex(
    (model) => model.name === modelName
  );

  // 如果启用了思考模式但没有选择具体模式，默认使用auto
  const thinkingType = editingModel.value.thinkingEnabled
    ? editingModel.value.thinkingType || "auto"
    : null;

  // 创建模型对象
  const modelData: any = { name: modelName };
  if (thinkingType) {
    modelData.thinking = {
      type: thinkingType as "enabled" | "disabled" | "auto",
    };
  }

  if (existingModelIndex !== -1) {
    // 更新现有模型
    currentEditingService.value.customModels[existingModelIndex] = modelData;
  } else {
    // 添加新模型
    currentEditingService.value.customModels.push(modelData);
  }

  updateService(currentEditingService.value);
  closeModelDialog();
};

onMounted(async () => {
  try {
    await initConfig();
    // 确保 aiServices 是数组
    if (!Array.isArray(config.value.aiServices)) {
      config.value.aiServices = [];
    }

    // 确保按钮配置有正确的结构
    const configPrompts = config.value.prompts as any;
    if (!configPrompts || typeof configPrompts !== "object") {
      config.value.prompts = { post: [], reply: [] };
    } else {
      // 确保每个场景都有正确的数组
      for (const scene of promptScenes) {
        if (!Array.isArray(configPrompts[scene])) {
          configPrompts[scene] = [];
        }
      }
    }
  } catch (error) {
    log_error("初始化配置失败:", error);
    // 确保即使初始化失败也有默认值
    config.value.aiServices = [];
    config.value.prompts = { post: [], reply: [] };
  }
});
</script>

<!-- 基础样式 - 可以添加到你的全局样式或组件样式中 -->
<style>
.form-input {
  @apply w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-base py-2.5 px-4 focus:border-blue-500 focus:ring-blue-500 focus:bg-white transition-colors;
}

.config-item {
  @apply space-y-2;
}

.service-item {
  @apply transition-all duration-200;
}

.service-item:hover {
  @apply shadow-md;
}

/* 优化下拉框样式 */
select.form-input {
  appearance: none;
  padding-right: 2.5rem;
  padding-left: 1rem;
}

/* 添加滚动条样式 */
select.form-input option {
  padding: 8px;
  font-size: 1.1rem;
}

/* 调整内容边距 */
.config-item label {
  @apply pl-1;
}
</style>
