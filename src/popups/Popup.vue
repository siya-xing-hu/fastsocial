<template>
  <div class="w-80 min-w-80 box-border bg-gray-200">
    <div class="text-sm bg-white px-5 py-4 rounded-b-xl">
      <div class="flex items-center justify-between ml-1" style="height: 28px;">
        <div class="flex items-center"><a class="flex items-center text-decoration-none" target="_blank"
            href="https://immersivetranslate.com/accounts/login?from=plugin&amp;utm_source=extension&amp;utm_medium=extension&amp;utm_campaign=popup_more"><img
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAn1BMVEUAAADt7vHu7vLu7vLv7+/n5+fFxcXu7vHv7/PHx8eamprt7fLt7fHn5+vGxsbS09Surq6fn5+ZmZmZmZnGxsbGxsbt7/K/v7/Hx8ft7vHGxsaZmZn09vnk5eeqqquenp7p6u3X2NnLy8vU1dbr7O67u7uvr6/o6evh4uPR0dLCwsLAwMDZ2ty9vb6kpaWhoaHe3+HPz8+zs7OkpKTc3d7Gt0R8AAAAGXRSTlMA779wIBDv338gv5+AgHDv7+/v36+gn3BgD0kJmgAAAS1JREFUKM9dkOmSgyAQhNFo7mTvYwYEBa9oorne/9l2hqJSbr4q+NHNdBcjAukyXgBE8SwRU5IYHmwm1iyCCdFMBJbwxDK8B2iKLGjl8VAC+JmEcqzRrmnP5yzrbm93SuOeDQCcpNToGaV8ISGmAfBGPce+qjrsjSxYSbkBGtt1tZGEueLpwsZW8A8snlj2jD0efRZVtxzw4Ia2BFgIch1qOaHCM4lsHHA0WpOpKyk7qX2WWLBhhhxU7grlKlV7I+LyAm+DUplS/sqv2HL5FiDDSio15CQOdHrrl5L6kpqEMOHwTlIiOKu0WIDy5Bfkn3+HJTYXRNdmWXtA1nmJfu1lgRNcQw2encV/2J0I7OdIXM1YIzH/FQ9WX4i1JF4RP1dBDNZ+/S7lx/onDcIfdi8x4pYpSxgAAAAASUVORK5CYII="><span
              class="text-xs ml-2 text-label">Not Logged In</span></a><a
            title="After upgrading to Pro membership, you can enjoy DeepL, OpenAI, Claude, Gemini translations. Click here to upgrade."
            target="_blank" class="ml-2"
            href="https://immersivetranslate.com/pricing/?utm_source=extension&amp;utm_medium=extension&amp;utm_campaign=popup_footer"><img
              src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIxMiIgZmlsbD0ibm9uZSI+PHBhdGggZmlsbD0iIzk5OSIgZD0iTTYuODk3IDMuMjQyYy40MTUgMCAuNzIuMTExLjkyOC4zNDcuMjA3LjIzNS4zMTguNTI2LjMxOC44NzMgMCAuMzQ2LS4xMS42MjMtLjMxOC44NDUtLjIwOC4yMjItLjUyNy4zMzMtLjkyOC4zMzNoLTEuMzNWMy4yNDJoMS4zM1ptOS44NDYgMS43ODhjLjM4OCAwIC42NjUuMTUyLjg0NS40NTcuMTUyLjI2NC4yMzUuNTgyLjI2My45ODR2LjMxOWMwIC40OTktLjA4My44ODctLjI2MyAxLjE5Mi0uMTguMzA0LS40NTcuNDU3LS44My40NTctLjM4OSAwLS42NjYtLjE1My0uODQ2LS40NDQtLjE1Mi0uMjYzLS4yMzUtLjU5NS0uMjYzLTEuMDExdi0uMjkxYzAtLjQ4NS4wODMtLjg3My4yNjMtMS4xNzguMTgtLjMwNS40NDMtLjQ4NS44MzEtLjQ4NVptLTMuNDA3LTEuMTM2YTEuMTcgMS4xNyAwIDAgMC0uNzA2LjIzNSAxLjQ4MiAxLjQ4MiAwIDAgMC0uNDE1LjVsLS4wODMuMTY1LS4wNy0uODAzaC0xLjM1N3Y1LjQzMmgxLjQ1NFY1Ljc2NGEuODguODggMCAwIDEgLjMxOS0uMzg4Yy4xMS0uMDY5LjI1LS4xMS40MTUtLjEyNGguMTI1bC41NC4wMTQuMTY2LTEuMzE3Yy0uMDctLjAxNC0uMTI0LS4wMjgtLjE5NC0uMDQxLS4wNTUtLjAxNC0uMTI0LS4wMTQtLjE5NC0uMDE0Wk02Ljg5NiAyLjEySDQuMTE0djcuMzE3aDEuNDY4VjYuNzloMS4zM2MuODQ0IDAgMS40OTUtLjIwOCAxLjk4LS42MzguNDg1LS40My43Mi0uOTgzLjcyLTEuNjlzLS4yMzUtMS4yNjEtLjcyLTEuNjljLS40NDMtLjM4OS0xLjAzOS0uNjEtMS43NzMtLjYzOGwtLjIyMS0uMDE0Wm05Ljg0NyAxLjc3NGMtLjgwMyAwLTEuNDI2LjI2My0xLjg4My43NzYtLjQxNi40Ny0uNjM3IDEuMDY3LS42NzkgMS43NzN2LjMzM2MwIC44MTguMjIyIDEuNDgzLjY3OSAxLjk5NS40NTcuNTEzIDEuMDguNzc2IDEuODgzLjc3Ni44MDQgMCAxLjQyNy0uMjYzIDEuODg0LS43NzYuNDE1LS40Ny42MzctMS4wNTMuNjc4LTEuNzczdi0uMzMzYzAtLjgxNy0uMjIxLTEuNDgzLS42NzgtMS45OTUtLjQ1Ny0uNTEzLTEuMDgtLjc3Ni0xLjg4NC0uNzc2Wk0xOC4wMDMgMGE2IDYgMCAwIDEgMCAxMkgwVjMuNDIzQTMuNDIgMy40MiAwIDAgMSAzLjQyIDBoMTQuNTgzWiIvPjwvc3ZnPg=="></a>
        </div>
        <div class="flex items-center p-1"><span class="text-gray-9">Snapshot</span><svg
            xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="#666666">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M19 8H9C8.44772 8 8 8.44772 8 9V11H20V9C20 8.44772 19.5523 8 19 8ZM21 11V9C21 7.89543 20.1046 7 19 7H9C7.89543 7 7 7.89543 7 9V11V12V19C7 20.1046 7.89543 21 9 21H13V20H9C8.44772 20 8 19.5523 8 19V12H20V14H21V12V11ZM9 9H11V10H9V9ZM17 9H15V10H17V9ZM12 9H14V10H12V9ZM21 17H18V14H17V17H14V18H17V21H18V18H21V17Z">
            </path>
          </svg></div>
      </div>

      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6" style="min-width: 70px;">API-KEY：</label>
          <input type="password" v-model="apiKey" @blur="handleChange('apiKey', apiKey)" class="pl-3">
        </div>
      </div>

      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6" style="min-width: 70px;">ORG：</label>
          <input type="password" v-model="org" @blur="handleChange('org', org)" class="pl-3">
        </div>
      </div>



      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6" style="min-width: 70px;">Model：</label>
          <select v-model="model" @change="handleChange('model', model)" autocomplete="off" class="pl-3">
            <option value="gpt-3.5-turbo">GPT-3.5</option>
            <option value="gpt-4-turbo">GPT-4</option>
            <option value="gpt-4o">GPT-4o</option>
          </select>
        </div>
      </div>

      <div class="mt-3 text-sm px-1 text-gray-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <label class="mb-0 mr-2 shrink-0">Always translate this posts</label>
          </div>
          <input type="checkbox" v-model="alwaysTranslate" @change="handleChange('alwaysTranslate', alwaysTranslate)"
            role="switch" class="shrink-0 w-9 h-3">
        </div>
      </div>
    </div>

    <footer>
      <div class="px-3 py-1.5 text-sm flex items-center justify-between h-10">
        <div class="flex flex-row items-center justify-center cursor-pointer" @click="openOptions">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="#B3B3B3">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M11.0402 2.56219C10.8673 2.38914 10.6329 2.29178 10.3883 2.2915H9.61327C9.36886 2.29316 9.13508 2.39169 8.96323 2.5655C8.79138 2.7393 8.6955 2.97417 8.6966 3.21859V4.08317L7.88827 4.38838C7.27152 4.62052 6.69744 4.95314 6.18931 5.37275L5.51952 5.92484L4.76848 5.4915L4.7539 5.48317C4.61453 5.40172 4.45595 5.35893 4.29452 5.35921C4.13241 5.35919 3.97315 5.40182 3.83273 5.48282C3.69231 5.56382 3.57567 5.68033 3.49452 5.82067L3.12577 6.45817C3.00657 6.66857 2.9746 6.91731 3.03672 7.15101C3.09885 7.38471 3.25012 7.58474 3.45806 7.70817L3.47056 7.72171L4.21952 8.15505L4.07785 9.00817C3.96954 9.6575 3.96954 10.3203 4.07785 10.9696L4.2164 11.8207L3.46848 12.2519L3.44556 12.2655C3.23393 12.3881 3.07956 12.5896 3.0163 12.8259C2.95303 13.0622 2.98603 13.3139 3.10806 13.5259L3.50077 14.2061C3.58233 14.3463 3.6992 14.4627 3.83975 14.5436C3.9803 14.6246 4.13961 14.6673 4.30181 14.6675C4.46324 14.6678 4.62182 14.625 4.76119 14.5436L4.7841 14.53L5.53306 14.0978L6.20181 14.6457C6.70534 15.0591 7.27331 15.3871 7.88306 15.6165L8.6914 15.9217V16.7853C8.6914 17.0298 8.78849 17.2644 8.96134 17.4375C9.1342 17.6105 9.36868 17.7079 9.61327 17.7082H10.3883C10.5096 17.7086 10.6299 17.685 10.7422 17.6389C10.8544 17.5928 10.9565 17.525 11.0425 17.4393C11.1285 17.3537 11.1968 17.2519 11.2435 17.1399C11.2901 17.0278 11.3142 16.9077 11.3143 16.7863V15.9217L12.1226 15.6165C12.7394 15.3844 13.3135 15.0517 13.8216 14.6321L14.4914 14.08L15.2424 14.5134L15.257 14.5228C15.469 14.6447 15.7206 14.6775 15.9567 14.614C16.1929 14.5505 16.3941 14.3959 16.5164 14.1842L16.8851 13.5467C17.0068 13.3348 17.0397 13.0834 16.9764 12.8473C16.9132 12.6113 16.759 12.41 16.5476 12.2873L16.532 12.278L15.782 11.8457L15.9237 10.9915C16.032 10.3422 16.032 9.67938 15.9237 9.03005L15.7851 8.179L16.5331 7.74775L16.556 7.73421C16.7676 7.61158 16.922 7.41003 16.9852 7.17376C17.0485 6.93749 17.0155 6.68577 16.8935 6.4738L16.5008 5.79359C16.4192 5.65338 16.3023 5.53699 16.1618 5.45603C16.0212 5.37506 15.8619 5.33234 15.6997 5.33213C15.5383 5.33185 15.3797 5.37464 15.2404 5.45609L15.2174 5.46963L14.4685 5.90192L13.7997 5.354C13.2962 4.94059 12.7282 4.61262 12.1185 4.38317L11.3101 4.07796V3.21442C11.3101 2.96983 11.2131 2.73524 11.0402 2.56219ZM9.61327 1.0415H10.3883C10.6736 1.04164 10.9562 1.09798 11.2197 1.20731C11.4833 1.31663 11.7228 1.4768 11.9245 1.67867C12.1261 1.88054 12.2861 2.12016 12.3951 2.38384C12.5042 2.64753 12.5603 2.93011 12.5601 3.21546C13.2969 3.49312 13.9834 3.88931 14.5924 4.38838L14.6154 4.37484C14.8625 4.2313 15.1356 4.13798 15.4189 4.10025C15.7023 4.06251 15.9903 4.0811 16.2664 4.15495C16.5425 4.2288 16.8013 4.35644 17.028 4.53057C17.2547 4.7047 17.4447 4.92187 17.5872 5.16963L17.9799 5.84984C18.1226 6.09693 18.2153 6.36972 18.2525 6.65262C18.2897 6.93552 18.2709 7.22299 18.197 7.49859C18.123 7.7742 17.9956 8.03254 17.8218 8.25885C17.648 8.48516 17.4313 8.67501 17.1841 8.81755L17.1612 8.83109C17.2248 9.21777 17.2569 9.60899 17.257 10.0009C17.2552 10.4017 17.2203 10.8016 17.1529 11.1967L17.1685 11.205C17.6673 11.4933 18.0313 11.9678 18.1803 12.5243C18.3294 13.0809 18.2513 13.6738 17.9633 14.1728L17.5956 14.8103C17.3075 15.3093 16.833 15.6734 16.2765 15.8227C15.72 15.9719 15.1269 15.894 14.6279 15.6061L14.6133 15.5978C13.999 16.1043 13.3053 16.5059 12.5601 16.7863C12.5599 17.3622 12.331 17.9145 11.9237 18.3217C11.5165 18.729 10.9642 18.9579 10.3883 18.9582H9.61327C9.32792 18.958 9.04539 18.9017 8.78181 18.7924C8.51823 18.683 8.27877 18.5229 8.07709 18.321C7.87541 18.1191 7.71547 17.8795 7.6064 17.6158C7.49733 17.3521 7.44126 17.0696 7.4414 16.7842C6.70459 16.5066 6.01812 16.1104 5.40911 15.6113L5.38619 15.6248C5.13939 15.7686 4.86664 15.8623 4.58357 15.9005C4.30049 15.9387 4.01267 15.9206 3.73659 15.8474C3.4605 15.7741 3.20159 15.6471 2.97469 15.4736C2.74779 15.3001 2.55736 15.0835 2.41431 14.8363L2.0216 14.1561C1.8789 13.909 1.78628 13.6362 1.74904 13.3533C1.7118 13.0704 1.73068 12.7829 1.80459 12.5073C1.87849 12.2317 2.00599 11.9734 2.17977 11.7471C2.35356 11.5208 2.57025 11.3309 2.81744 11.1884L2.84035 11.1748C2.7767 10.7882 2.74465 10.3969 2.74452 10.005C2.74637 9.60425 2.78121 9.20429 2.84869 8.80921L2.83306 8.80088C2.33422 8.51264 1.97027 8.0381 1.82123 7.48158C1.67218 6.92506 1.75025 6.33214 2.03827 5.83317L2.40598 5.19046C2.69404 4.69144 3.16851 4.32727 3.72504 4.17803C4.28157 4.02879 4.87459 4.1067 5.37369 4.39463L5.38827 4.40296C6.00243 3.89603 6.69615 3.49408 7.4414 3.21338C7.44167 2.63745 7.67058 2.08518 8.07783 1.67794C8.48507 1.27069 9.03734 1.04178 9.61327 1.0415ZM11.1583 8.26761C10.8156 8.03869 10.4129 7.9165 10.0008 7.9165C9.44828 7.9165 8.91838 8.136 8.52768 8.5267C8.13698 8.9174 7.91748 9.4473 7.91748 9.99984C7.91748 10.4119 8.03967 10.8147 8.26859 11.1573C8.49751 11.4999 8.82288 11.7669 9.20356 11.9246C9.58424 12.0823 10.0031 12.1235 10.4073 12.0431C10.8114 11.9628 11.1826 11.7643 11.474 11.473C11.7653 11.1816 11.9637 10.8104 12.0441 10.4063C12.1245 10.0021 12.0832 9.58326 11.9256 9.20258C11.7679 8.8219 11.5009 8.49653 11.1583 8.26761ZM8.14891 7.22827C8.69708 6.862 9.34154 6.6665 10.0008 6.6665C10.8849 6.6665 11.7327 7.01769 12.3578 7.64281C12.983 8.26794 13.3341 9.11578 13.3341 9.99984C13.3341 10.6591 13.1387 11.3036 12.7724 11.8517C12.4061 12.3999 11.8855 12.8271 11.2764 13.0794C10.6673 13.3317 9.99712 13.3977 9.35051 13.2691C8.70391 13.1405 8.10997 12.823 7.64379 12.3569C7.17762 11.8907 6.86015 11.2967 6.73153 10.6501C6.60291 10.0035 6.66892 9.33331 6.92122 8.72423C7.17351 8.11514 7.60075 7.59454 8.14891 7.22827Z">
            </path>
          </svg>
          <span class="ml-1 text-gray-6">Options</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { onInput } from "../config";

const apiKey = ref<string>('');
const org = ref<string>('');
const model = ref<string>('gpt-3.5-turbo');
const alwaysTranslate = ref<boolean>(false);

function handleChange(field: string, value: any) {
  onInput(field, value);
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

onMounted(async () => {
  const storage = await chrome.storage.local.get()

  apiKey.value = storage["apiKey"] ?? "";
  org.value = storage["org"] ?? "";
  model.value = storage["model"] ?? 'gpt-3.5-turbo';
  alwaysTranslate.value = storage["alwaysTranslate"] ?? false;
});
</script>

<style>
.loader {
  right: 40px;
  position: absolute;
  margin-top: -20px;
  display: grid;
}

.check-icon {
  scale: 0.4;
  right: 0;
  position: absolute;
  margin-top: -55px;
  display: grid;
}
</style>
